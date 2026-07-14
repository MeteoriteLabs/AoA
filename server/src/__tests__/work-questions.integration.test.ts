import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  agentWakeupRequests,
  agents,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  discussions,
  executionWorkspaces,
  heartbeatRuns,
  hubItems,
  internalAgentRuns,
  issues,
  projects,
  userRoles,
  workQuestionContinuationRequests,
  workQuestions,
  type Db,
} from "@armyofagents/db";
import { workQuestionContinuationService } from "../services/work-question-continuations.js";
import { workQuestionService } from "../services/work-questions.js";
import { workQuestionSlaService } from "../services/work-question-sla.js";
import { issueService } from "../services/issues.js";
import { bindHeartbeatWorkQuestionContinuation } from "../services/work-question-continuation-terminal.js";
import { askHumanForActiveRun } from "../mcp/tools/ask-founder-tool.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite("durable work questions (real PostgreSQL)", () => {
  let db: Db;
  const companyId = randomUUID();
  const agentId = randomUUID();
  const runId = randomUUID();
  const issueId = randomUUID();
  const projectId = randomUUID();
  const discussionId = randomUUID();
  const workspaceId = randomUUID();
  const userId = `work-question-${randomUUID()}`;

  function continuationWorker() {
    return workQuestionContinuationService(db, {
      enqueueHeartbeat: async (input) => {
        const existing = await db.select({ runId: agentWakeupRequests.runId })
          .from(agentWakeupRequests)
          .where(and(
            eq(agentWakeupRequests.companyId, input.companyId),
            eq(agentWakeupRequests.idempotencyKey, input.idempotencyKey),
          ))
          .then((rows) => rows.find((row) => row.runId) ?? null);
        if (existing?.runId) return { id: existing.runId };

        return db.transaction(async (tx) => {
          const wakeup = await tx.insert(agentWakeupRequests).values({
            companyId: input.companyId,
            agentId: input.agentId,
            source: "automation",
            triggerDetail: "system",
            reason: "work_question_continuation",
            payload: input,
            status: "queued",
            requestedByActorType: "system",
            requestedByActorId: "work-question-continuation-test",
            idempotencyKey: input.idempotencyKey,
          }).returning().then((rows) => rows[0]);
          const run = await tx.insert(heartbeatRuns).values({
            companyId: input.companyId,
            agentId: input.agentId,
            invocationSource: "automation",
            triggerDetail: "system",
            status: "queued",
            wakeupRequestId: wakeup.id,
            contextSnapshot: { issueId: input.issueId, questionId: input.questionId },
          }).returning().then((rows) => rows[0]);
          await tx.update(agentWakeupRequests).set({ runId: run.id }).where(eq(agentWakeupRequests.id, wakeup.id));
          return run;
        });
      },
    });
  }

  beforeAll(async () => {
    db = createDb(databaseUrl!);
    const now = new Date();
    await db.insert(companies).values({
      id: companyId,
      name: "Work Question Integration",
      issuePrefix: `WQ${Math.floor(Math.random() * 9000 + 1000)}`,
    });
    await db.insert(authUsers).values({
      id: userId,
      name: "Question Owner",
      email: `${userId}@example.test`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "owner",
    });
    await db.insert(userRoles).values({ companyId, userId, role: "founder" });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Research Agent",
      role: "research",
      kind: "org",
      status: "idle",
      adapterType: "codex_local",
    });
    await db.insert(projects).values({
      id: projectId,
      companyId,
      name: "Product Research",
      type: "department",
      status: "in_progress",
    });
    await db.insert(discussions).values({
      id: discussionId,
      companyId,
      title: "Launch evidence strategy",
      scopeType: "department",
      scopeId: projectId,
      createdBy: userId,
    });
    await db.insert(executionWorkspaces).values({
      id: workspaceId,
      companyId,
      projectId,
      sourceIssueId: null,
      threadId: discussionId,
      mode: "shared_workspace",
      strategyType: "project_primary",
      name: "launch-evidence-thread",
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "on_demand",
      status: "running",
      contextSnapshot: { issueId },
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      projectId,
      title: "Choose interview sample",
      identifier: `WQ-${Math.floor(Math.random() * 1_000_000)}`,
      status: "in_progress",
      assigneeAgentId: agentId,
      responsibleUserId: userId,
      checkoutRunId: runId,
      sourceDiscussionId: discussionId,
      acceptanceCriteria: ["Document the selected sample"],
    });
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(companies).where(eq(companies.id, companyId));
    await db.delete(authUsers).where(eq(authUsers.id, userId));
  });

  it("commits one answer and one continuation request, then relays idempotently", async () => {
    const service = workQuestionService(db);
    const question = await service.create(companyId, {
      issueId,
      askingAgentId: agentId,
      originatingRunKind: "heartbeat",
      originatingRunId: runId,
      title: "Which interview sample should we use?",
      question: "Choose five deep interviews or twelve short interviews.",
      options: [
        { label: "Five deep", value: "five" },
        { label: "Twelve short", value: "twelve" },
      ],
      blocking: true,
    });
    expect(question.issueTitleSnapshot).toBe("Choose interview sample");
    expect(question.askingAgentNameSnapshot).toBe("Research Agent");
    expect(question.currentRecipientUserId).toBe(userId);
    const openMirror = await db.select().from(hubItems).where(and(
      eq(hubItems.companyId, companyId),
      eq(hubItems.sourceType, "work_question"),
      eq(hubItems.sourceId, question.id),
    )).then((rows) => rows[0]);
    expect(openMirror).toMatchObject({
      semanticType: "work_question",
      status: "open",
      ownerUserId: userId,
      relatedEntityId: issueId,
    });

    const answered = await service.answer(companyId, question.id, { userId }, {
      answer: { selectedValues: ["five"] },
      expectedVersion: 0,
      idempotencyKey: "answer-once",
    });
    expect(answered).toMatchObject({ status: "answered", version: 1, continuationStatus: "pending" });
    const repeated = await service.answer(companyId, question.id, { userId }, {
      answer: { selectedValues: ["five"] },
      expectedVersion: 0,
      idempotencyKey: "answer-once",
    });
    expect(repeated.id).toBe(answered.id);

    const requests = await db.select().from(workQuestionContinuationRequests).where(eq(
      workQuestionContinuationRequests.questionId,
      question.id,
    ));
    expect(requests).toHaveLength(1);
    expect(requests[0].downstreamIdempotencyKey).toBe(`work-question:${question.id}:answer:1`);
    expect(requests[0].continuationEnvelope).toMatchObject({
      version: 1,
      task: {
        id: issueId,
        title: "Choose interview sample",
        acceptanceCriteria: ["Document the selected sample"],
      },
      question: { id: question.id, text: "Choose five deep interviews or twelve short interviews." },
      answer: { value: { selectedValues: ["five"] }, version: 1, responderUserId: userId },
      provenance: {
        originatingRunKind: "heartbeat",
        originatingRunId: runId,
        executionWorkspaceId: null,
        sourceDiscussionId: discussionId,
      },
    });

    const relayed = await service.markRelayed(companyId, question.id, 1);
    expect(relayed).toMatchObject({ continuationStatus: "dispatched", continuationRunId: runId, version: 2 });
    const cancelledRequest = await db.select().from(workQuestionContinuationRequests).where(eq(
      workQuestionContinuationRequests.id,
      requests[0].id,
    )).then((rows) => rows[0]);
    expect(cancelledRequest.status).toBe("cancelled");
    const closedMirror = await db.select().from(hubItems).where(eq(hubItems.id, openMirror.id)).then((rows) => rows[0]);
    expect(closedMirror.status).toBe("archived");
  });

  it("accepts the shared workspace owned by the task's source Discussion", async () => {
    const question = await workQuestionService(db).create(companyId, {
      issueId,
      askingAgentId: agentId,
      originatingRunKind: "heartbeat",
      originatingRunId: runId,
      executionWorkspaceId: workspaceId,
      sourceDiscussionId: discussionId,
      title: "Depth or breadth?",
      question: "Which evidence strategy should drive the launch?",
      blocking: true,
    });

    expect(question).toMatchObject({
      issueId,
      executionWorkspaceId: workspaceId,
      sourceDiscussionId: discussionId,
    });
  });

  it("deduplicates producer retries and rejects invocation-content conflicts", async () => {
    const service = workQuestionService(db);
    const baseInput = {
      issueId,
      askingAgentId: agentId,
      originatingRunKind: "heartbeat" as const,
      originatingRunId: runId,
      producerInvocationId: "provider-tool-call-42",
      title: "Choose the evidence threshold",
      question: "Should the threshold be three or five interviews?",
      context: { constraints: { budget: "fixed", timeline: "two weeks" } },
      blocking: true,
    };

    const first = await service.create(companyId, baseInput);
    const transportRetry = await service.create(companyId, baseInput);
    const reconnectRetry = await service.create(companyId, {
      ...baseInput,
      producerInvocationId: "provider-tool-call-after-reconnect",
    });

    expect(transportRetry.id).toBe(first.id);
    expect(reconnectRetry.id).toBe(first.id);
    await expect(service.create(companyId, {
      ...baseInput,
      question: "Should the threshold be seven interviews?",
    })).rejects.toThrow(/reused with different question content/i);

    const persisted = await db.select().from(workQuestions).where(and(
      eq(workQuestions.companyId, companyId),
      eq(workQuestions.producerPayloadFingerprint, first.producerPayloadFingerprint!),
      eq(workQuestions.status, "open"),
    ));
    expect(persisted).toHaveLength(1);
  });

  it("dispatches a late answer through one idempotent wakeup", async () => {
    const service = workQuestionService(db);
    const question = await service.create(companyId, {
      issueId,
      askingAgentId: agentId,
      originatingRunKind: "heartbeat",
      originatingRunId: runId,
      title: "Choose incentive cap",
      question: "Should the cap be 100 or 250?",
      blocking: true,
    });
    await service.answer(companyId, question.id, { userId }, {
      answer: { text: "Use 100." },
      expectedVersion: 0,
      idempotencyKey: "late-answer",
    });
    await db.update(workQuestionContinuationRequests).set({ nextAttemptAt: new Date(0) }).where(eq(
      workQuestionContinuationRequests.questionId,
      question.id,
    ));

    const worker = continuationWorker();
    const first = await worker.processDue(new Date(), 10);
    const second = await worker.processDue(new Date(), 10);
    expect(first).toMatchObject({ claimed: 1, dispatched: 1, failed: 0 });
    expect(second.claimed).toBe(0);

    const wakeups = await db.select().from(agentWakeupRequests).where(and(
      eq(agentWakeupRequests.companyId, companyId),
      eq(agentWakeupRequests.idempotencyKey, `work-question:${question.id}:answer:1`),
    ));
    expect(wakeups).toHaveLength(1);
    expect(wakeups[0]).toMatchObject({ reason: "work_question_continuation", status: "queued" });
    expect((wakeups[0].payload as Record<string, unknown>).continuationEnvelope).toMatchObject({
      version: 1,
      question: { id: question.id, text: "Should the cap be 100 or 250?" },
      answer: { value: { text: "Use 100." }, version: 1 },
    });
    const updated = await db.select().from(workQuestions).where(eq(workQuestions.id, question.id)).then((rows) => rows[0]);
    expect(updated).toMatchObject({
      continuationStatus: "dispatched",
      continuationRunKind: "heartbeat",
      continuationRunId: wakeups[0].runId,
    });
    const continuationRuns = await db.select().from(heartbeatRuns).where(eq(
      heartbeatRuns.id,
      updated.continuationRunId!,
    ));
    expect(continuationRuns).toHaveLength(1);

    await db.update(heartbeatRuns).set({
      status: "succeeded",
      finishedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(heartbeatRuns.id, updated.continuationRunId!));
    expect(await worker.reconcileHeartbeatTerminals()).toBe(1);
    const completed = await db.select().from(workQuestions).where(eq(
      workQuestions.id,
      question.id,
    )).then((rows) => rows[0]);
    expect(completed).toMatchObject({
      continuationStatus: "completed",
      continuationRunId: updated.continuationRunId,
      continuationError: null,
    });
    expect(await worker.reconcileHeartbeatTerminals()).toBe(0);
  });

  it("reclaims a continuation claim left stale by a crashed worker", async () => {
    const service = workQuestionService(db);
    const question = await service.create(companyId, {
      issueId,
      askingAgentId: agentId,
      originatingRunKind: "heartbeat",
      originatingRunId: runId,
      title: "Choose the launch cohort",
      question: "Should the first cohort contain five or ten companies?",
      blocking: true,
    });
    await service.answer(companyId, question.id, { userId }, {
      answer: { text: "Start with five." },
      expectedVersion: 0,
      idempotencyKey: "stale-claim-answer",
    });
    await db.update(workQuestionContinuationRequests).set({
      status: "claimed",
      claimedAt: new Date(Date.now() - 10 * 60 * 1000),
      claimToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() - 8 * 60 * 1000),
      nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000),
    }).where(eq(workQuestionContinuationRequests.questionId, question.id));

    const result = await continuationWorker().processDue(new Date(), 10);
    expect(result).toMatchObject({ claimed: 1, dispatched: 1, failed: 0 });
    const request = await db.select().from(workQuestionContinuationRequests)
      .where(eq(workQuestionContinuationRequests.questionId, question.id))
      .then((rows) => rows[0]);
    expect(request).toMatchObject({ status: "dispatched", claimToken: null, leaseExpiresAt: null });
  });

  it("prevents a stale continuation owner from mutating a reclaimed request", async () => {
    const service = workQuestionService(db);
    const question = await service.create(companyId, {
      issueId,
      askingAgentId: agentId,
      originatingRunKind: "heartbeat",
      originatingRunId: runId,
      title: "Choose the launch channel",
      question: "Should the first launch use email or partner outreach?",
      blocking: true,
    });
    await service.answer(companyId, question.id, { userId }, {
      answer: { text: "Use partner outreach." },
      expectedVersion: 0,
      idempotencyKey: "reclaimed-owner-answer",
    });
    await db.update(workQuestionContinuationRequests).set({ nextAttemptAt: new Date(0) }).where(eq(
      workQuestionContinuationRequests.questionId,
      question.id,
    ));

    const staleWorker = continuationWorker();
    const [staleClaim] = await staleWorker.claimDue(new Date(), 1);
    expect(staleClaim.claimToken).toBeTruthy();
    await db.update(workQuestionContinuationRequests).set({
      leaseExpiresAt: new Date(0),
    }).where(eq(workQuestionContinuationRequests.id, staleClaim.id));

    const currentWorker = continuationWorker();
    const [currentClaim] = await currentWorker.claimDue(new Date(), 1);
    expect(currentClaim.claimToken).toBeTruthy();
    expect(currentClaim.claimToken).not.toBe(staleClaim.claimToken);

    expect(await staleWorker.dispatch(staleClaim)).toMatchObject({ status: "cancelled" });
    const stillOwned = await db.select().from(workQuestionContinuationRequests)
      .where(eq(workQuestionContinuationRequests.id, staleClaim.id))
      .then((rows) => rows[0]);
    expect(stillOwned).toMatchObject({ status: "claimed", claimToken: currentClaim.claimToken });

    expect(await currentWorker.dispatch(currentClaim)).toMatchObject({ status: "dispatched" });
    const finalized = await db.select().from(workQuestionContinuationRequests)
      .where(eq(workQuestionContinuationRequests.id, staleClaim.id))
      .then((rows) => rows[0]);
    expect(finalized).toMatchObject({ status: "dispatched", claimToken: null, leaseExpiresAt: null });
  });

  it("defers a late answer behind an active task run instead of coalescing it", async () => {
    const service = workQuestionService(db);
    const question = await service.create(companyId, {
      issueId,
      askingAgentId: agentId,
      originatingRunKind: "heartbeat",
      originatingRunId: runId,
      title: "Choose the evidence threshold",
      question: "Is three confirmed interviews enough to continue?",
      blocking: true,
    });
    await service.answer(companyId, question.id, { userId }, {
      answer: { text: "Require five confirmed interviews." },
      expectedVersion: 0,
      idempotencyKey: "active-run-late-answer",
    });
    await db.update(workQuestionContinuationRequests).set({
      nextAttemptAt: new Date(0),
    }).where(eq(workQuestionContinuationRequests.questionId, question.id));

    const result = await workQuestionContinuationService(db).processDue(new Date(), 10);

    expect(result).toMatchObject({ claimed: 1, dispatched: 1, failed: 0 });
    const deferred = await db.select().from(agentWakeupRequests).where(and(
      eq(agentWakeupRequests.companyId, companyId),
      eq(agentWakeupRequests.idempotencyKey, `work-question:${question.id}:answer:1`),
    )).then((rows) => rows[0]);
    expect(deferred).toMatchObject({
      reason: "work_question_continuation",
      status: "deferred_issue_execution",
      runId: null,
    });
    const updated = await db.select().from(workQuestions)
      .where(eq(workQuestions.id, question.id))
      .then((rows) => rows[0]);
    expect(updated).toMatchObject({
      continuationStatus: "dispatched",
      continuationRunKind: "heartbeat",
      continuationRunId: null,
    });

    const promotedRun = await db.insert(heartbeatRuns).values({
      companyId,
      agentId,
      invocationSource: "automation",
      triggerDetail: "system",
      status: "queued",
      wakeupRequestId: deferred.id,
      contextSnapshot: { issueId, questionId: question.id },
    }).returning().then((rows) => rows[0]);
    expect(await bindHeartbeatWorkQuestionContinuation(db, {
      companyId,
      runId: promotedRun.id,
      idempotencyKey: `work-question:${question.id}:answer:1`,
    })).toBe(question.id);
    const bound = await db.select().from(workQuestions)
      .where(eq(workQuestions.id, question.id))
      .then((rows) => rows[0]);
    expect(bound.continuationRunId).toBe(promotedRun.id);

    await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date() })
      .where(eq(heartbeatRuns.id, promotedRun.id));
    expect(await workQuestionContinuationService(db).reconcileHeartbeatTerminals()).toBe(1);
    const completed = await db.select().from(workQuestions)
      .where(eq(workQuestions.id, question.id))
      .then((rows) => rows[0]);
    expect(completed.continuationStatus).toBe("completed");
  });

  it("cancels the old agent's question when a task is reassigned", async () => {
    const replacementAgentId = randomUUID();
    const reassignedIssueId = randomUUID();
    const reassignedRunId = randomUUID();
    await db.insert(agents).values({
      id: replacementAgentId,
      companyId,
      name: "Replacement Research Agent",
      role: "research",
      kind: "org",
      status: "idle",
      adapterType: "codex_local",
    });
    await db.insert(heartbeatRuns).values({
      id: reassignedRunId,
      companyId,
      agentId,
      invocationSource: "on_demand",
      status: "running",
      contextSnapshot: { issueId: reassignedIssueId },
    });
    await db.insert(issues).values({
      id: reassignedIssueId,
      companyId,
      projectId,
      title: "Reassign interview analysis",
      identifier: `WQ-${Math.floor(Math.random() * 1_000_000)}`,
      status: "in_progress",
      assigneeAgentId: agentId,
      responsibleUserId: userId,
      checkoutRunId: reassignedRunId,
    });
    const question = await workQuestionService(db).create(companyId, {
      issueId: reassignedIssueId,
      askingAgentId: agentId,
      originatingRunKind: "heartbeat",
      originatingRunId: reassignedRunId,
      title: "Confirm the old agent's approach",
      question: "Should the original analysis continue?",
      blocking: true,
    });

    await issueService(db).update(
      reassignedIssueId,
      { assigneeAgentId: replacementAgentId },
      { actorType: "system" },
    );

    const [updated, mirror] = await Promise.all([
      db.select().from(workQuestions)
        .where(eq(workQuestions.id, question.id))
        .then((rows) => rows[0]),
      db.select().from(hubItems)
        .where(and(
          eq(hubItems.sourceType, "work_question"),
          eq(hubItems.sourceId, question.id),
        ))
        .then((rows) => rows[0]),
    ]);
    expect(updated).toMatchObject({
      status: "cancelled",
      continuationStatus: "not_needed",
    });
    expect(mirror.status).toBe("archived");
  });

  it("parks unsupported runtimes immediately and persists visible waiting state", async () => {
    const parkedRunId = randomUUID();
    const parkedIssueId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: parkedRunId,
      companyId,
      agentId,
      invocationSource: "on_demand",
      status: "running",
      contextSnapshot: { issueId: parkedIssueId },
    });
    await db.insert(issues).values({
      id: parkedIssueId,
      companyId,
      projectId,
      title: "Choose the launch cohort",
      identifier: `WQ-${Math.floor(Math.random() * 1_000_000)}`,
      status: "in_progress",
      assigneeAgentId: agentId,
      responsibleUserId: userId,
      checkoutRunId: parkedRunId,
    });

    const result = await askHumanForActiveRun({
      db,
      companyId,
      agentId,
      runId: parkedRunId,
    }, {
      question: "Which cohort should launch first?",
      context: "The runtime cannot pause safely, so this run must park.",
    });

    const persistedRun = await db.select().from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, parkedRunId))
      .then((rows) => rows[0]);
    expect(result).toMatchObject({ answered: false, status: "parked" });
    expect(persistedRun).toMatchObject({
      livenessState: "waiting_on_human",
      livenessReason: "work_question",
      nextAction: `work_question:${result.questionId}`,
    });
  });

  it("parks a task-bound Crew question and dispatches exactly one Crew continuation", async () => {
    const crewAgentId = randomUUID();
    const crewRunId = randomUUID();
    const crewIssueId = randomUUID();
    await db.insert(agents).values({
      id: crewAgentId,
      companyId,
      name: "Product Crew",
      role: "product",
      kind: "aoa",
      status: "idle",
      adapterType: "codex_local",
    });
    await db.insert(internalAgentRuns).values({
      id: crewRunId,
      companyId,
      agentId: crewAgentId,
      triggerType: "sub_agent",
      triggerSource: "task",
      status: "running",
      relatedEntityType: "task",
      relatedEntityId: crewIssueId,
    });
    await db.insert(issues).values({
      id: crewIssueId,
      companyId,
      projectId,
      title: "Select pricing evidence",
      identifier: `WQ-${Math.floor(Math.random() * 1_000_000)}`,
      status: "in_progress",
      assigneeAgentId: crewAgentId,
      responsibleUserId: userId,
      checkoutRunId: crewRunId,
      executionRunId: crewRunId,
      sourceDiscussionId: discussionId,
    });

    const parked = await askHumanForActiveRun({
      db,
      companyId,
      agentId: crewAgentId,
      runId: crewRunId,
      originatingRunKind: "internal_agent",
      producerInvocationId: "crew-product-question",
    }, {
      question: "Which pricing evidence should lead the recommendation?",
      context: "The Crew task cannot finish the recommendation without this choice.",
    });
    expect(parked).toMatchObject({ answered: false, status: "parked" });
    const question = await db.select().from(workQuestions)
      .where(eq(workQuestions.id, parked.questionId))
      .then((rows) => rows[0]);
    expect(question).toMatchObject({
      issueId: crewIssueId,
      askingAgentId: crewAgentId,
      originatingRunKind: "internal_agent",
      originatingRunId: crewRunId,
      status: "open",
    });

    await workQuestionService(db).answer(companyId, question.id, { userId }, {
      answer: { text: "Lead with willingness-to-pay interviews." },
      expectedVersion: 0,
      idempotencyKey: "crew-answer-once",
    });
    await db.update(workQuestionContinuationRequests).set({ nextAttemptAt: new Date(0) }).where(eq(
      workQuestionContinuationRequests.questionId,
      question.id,
    ));
    const first = await continuationWorker().processDue(new Date(), 10);
    const second = await continuationWorker().processDue(new Date(), 10);
    expect(first).toMatchObject({ dispatched: 1, failed: 0 });
    expect(second).toMatchObject({ dispatched: 0, failed: 0 });

    const wakeups = await db.select().from(agentWakeupRequests).where(and(
      eq(agentWakeupRequests.companyId, companyId),
      eq(agentWakeupRequests.idempotencyKey, `work-question:${question.id}:answer:1`),
    ));
    expect(wakeups).toHaveLength(1);
    expect(wakeups[0]).toMatchObject({
      agentId: crewAgentId,
      source: "work_question_continuation",
      reason: "work_question_continuation",
      status: "queued",
    });
    expect(wakeups[0].payload).toMatchObject({
      issueId: crewIssueId,
      questionId: question.id,
      answer: { text: "Lead with willingness-to-pay interviews." },
      continuationIdempotencyKey: `work-question:${question.id}:answer:1`,
    });
    const dispatched = await db.select().from(workQuestions)
      .where(eq(workQuestions.id, question.id))
      .then((rows) => rows[0]);
    expect(dispatched).toMatchObject({
      continuationStatus: "dispatched",
      continuationRunKind: "internal_agent",
      continuationRunId: null,
    });

    const continuationRunId = randomUUID();
    await db.insert(internalAgentRuns).values({
      id: continuationRunId,
      companyId,
      agentId: crewAgentId,
      triggerType: "sub_agent",
      triggerSource: "work_question_continuation",
      status: "completed",
      relatedEntityType: "task",
      relatedEntityId: crewIssueId,
      continuationIdempotencyKey: `work-question:${question.id}:answer:1`,
      completedAt: new Date(),
    });
    expect(await continuationWorker().reconcileInternalAgentTerminals()).toBe(1);
    const completed = await db.select().from(workQuestions)
      .where(eq(workQuestions.id, question.id))
      .then((rows) => rows[0]);
    expect(completed).toMatchObject({
      continuationStatus: "completed",
      continuationRunKind: "internal_agent",
      continuationRunId,
      continuationError: null,
    });
    expect(await continuationWorker().reconcileInternalAgentTerminals()).toBe(0);
  });

  it("snapshots a project SLA override and breaches it exactly once without reassigning", async () => {
    await db.update(projects).set({ humanQuestionSlaHours: 3 }).where(eq(projects.id, projectId));
    const service = workQuestionService(db);
    const createdAt = Date.now();
    const question = await service.create(companyId, {
      issueId,
      askingAgentId: agentId,
      originatingRunKind: "heartbeat",
      originatingRunId: runId,
      title: "Confirm the overdue launch choice",
      question: "Which launch choice should the agent use?",
      blocking: true,
    });
    expect(question).toMatchObject({
      slaDurationHours: 3,
      slaSource: "project",
      slaSourceId: projectId,
      currentRecipientUserId: userId,
    });
    expect(question.dueAt.getTime()).toBeGreaterThanOrEqual(createdAt + 3 * 60 * 60 * 1000 - 2_000);

    await db.update(workQuestions).set({ dueAt: new Date(Date.now() - 1_000) })
      .where(eq(workQuestions.id, question.id));
    const first = await workQuestionSlaService(db, {
      createNotification: async () => {
        throw new Error("temporary notification outage");
      },
    }).processDue(new Date(), 10);
    const afterFailure = await db.select().from(workQuestions)
      .where(eq(workQuestions.id, question.id))
      .then((rows) => rows[0]);
    expect(first).toMatchObject({ breached: 1, notificationFailures: 1 });
    expect(afterFailure.slaBreachedAt).toBeInstanceOf(Date);
    expect(afterFailure.slaNotificationsCompletedAt).toBeNull();

    const second = await workQuestionSlaService(db).processDue(new Date(), 10);
    const third = await workQuestionSlaService(db).processDue(new Date(), 10);
    expect(second).toMatchObject({ breached: 0, notificationFailures: 0 });
    expect(third.scanned).toBe(0);

    const breached = await db.select().from(workQuestions)
      .where(eq(workQuestions.id, question.id))
      .then((rows) => rows[0]);
    expect(breached.slaBreachedAt).toBeInstanceOf(Date);
    expect(breached.slaNotificationsCompletedAt).toBeInstanceOf(Date);
    expect(breached.currentRecipientUserId).toBe(userId);
    const mirror = await db.select().from(hubItems).where(and(
      eq(hubItems.companyId, companyId),
      eq(hubItems.sourceType, "work_question"),
      eq(hubItems.sourceId, question.id),
    )).then((rows) => rows[0]);
    expect(mirror).toMatchObject({ priority: "urgent", ownerUserId: userId });
    const breachNotifications = await db.select().from(hubItems).where(and(
      eq(hubItems.companyId, companyId),
      eq(hubItems.type, "work_question.sla_breached"),
      eq(hubItems.relatedEntityId, issueId),
    ));
    expect(breachNotifications.filter((row) => row.createdAt >= question.createdAt)).toHaveLength(1);

    await service.cancelByUser(companyId, question.id, { userId }, breached.version);
    await db.update(projects).set({ humanQuestionSlaHours: null }).where(eq(projects.id, projectId));
  });

  it("rejects an un-tasked Crew run before creating a durable question", async () => {
    const crewAgentId = randomUUID();
    const crewRunId = randomUUID();
    await db.insert(agents).values({
      id: crewAgentId,
      companyId,
      name: "Conversation Crew",
      role: "discussion",
      kind: "aoa",
      status: "idle",
      adapterType: "codex_local",
    });
    await db.insert(internalAgentRuns).values({
      id: crewRunId,
      companyId,
      agentId: crewAgentId,
      triggerType: "sub_agent",
      triggerSource: "discussion",
      status: "running",
      relatedEntityType: "discussion",
      relatedEntityId: discussionId,
    });

    await expect(askHumanForActiveRun({
      db,
      companyId,
      agentId: crewAgentId,
      runId: crewRunId,
      originatingRunKind: "internal_agent",
    }, {
      question: "Should this un-tasked conversation become durable?",
    })).rejects.toThrow(/not attached to a task/i);
  });

  it("cancels open questions and active continuations when their task closes", async () => {
    const service = workQuestionService(db);
    const openQuestion = await service.create(companyId, {
      issueId,
      askingAgentId: agentId,
      originatingRunKind: "heartbeat",
      originatingRunId: runId,
      title: "Confirm final wording",
      question: "Should the final report use the short title?",
      blocking: true,
    });
    const answeredQuestion = await service.create(companyId, {
      issueId,
      askingAgentId: agentId,
      originatingRunKind: "heartbeat",
      originatingRunId: runId,
      title: "Confirm the appendix",
      question: "Should the appendix include raw interview notes?",
      blocking: true,
    });
    await service.answer(companyId, answeredQuestion.id, { userId }, {
      answer: { text: "Include the redacted notes." },
      expectedVersion: 0,
      idempotencyKey: "terminal-task-answer",
    });
    await db.update(workQuestionContinuationRequests).set({ nextAttemptAt: new Date(0) }).where(eq(
      workQuestionContinuationRequests.questionId,
      answeredQuestion.id,
    ));
    await continuationWorker().processDue(new Date(), 10);
    const continuationKey = `work-question:${answeredQuestion.id}:answer:1`;
    const crewContinuationRunId = randomUUID();
    await db.insert(internalAgentRuns).values({
      id: crewContinuationRunId,
      companyId,
      agentId,
      triggerType: "sub_agent",
      triggerSource: "work_question_continuation",
      status: "running",
      relatedEntityType: "task",
      relatedEntityId: issueId,
      continuationIdempotencyKey: continuationKey,
    });
    await db.update(agentWakeupRequests).set({
      status: "processing",
      claimedAt: new Date(),
      claimToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
    }).where(eq(agentWakeupRequests.idempotencyKey, continuationKey));

    await issueService(db).update(issueId, { status: "done" }, { actorType: "system" });

    const [openAfter, answeredAfter, wakeupAfter, crewRunAfter] = await Promise.all([
      db.select().from(workQuestions).where(eq(workQuestions.id, openQuestion.id)).then((rows) => rows[0]),
      db.select().from(workQuestions).where(eq(workQuestions.id, answeredQuestion.id)).then((rows) => rows[0]),
      db.select().from(agentWakeupRequests).where(eq(
        agentWakeupRequests.idempotencyKey,
        continuationKey,
      )).then((rows) => rows[0]),
      db.select().from(internalAgentRuns)
        .where(eq(internalAgentRuns.id, crewContinuationRunId))
        .then((rows) => rows[0]),
    ]);
    expect(openAfter).toMatchObject({ status: "cancelled", continuationStatus: "not_needed" });
    expect(answeredAfter).toMatchObject({ status: "answered", continuationStatus: "not_needed" });
    expect(wakeupAfter.status).toBe("cancelled");
    expect(wakeupAfter.claimToken).toBeNull();
    expect(wakeupAfter.leaseExpiresAt).toBeNull();
    expect(crewRunAfter).toMatchObject({
      status: "cancelled",
      errorMessage: "Task done",
    });
    const continuationRunAfter = await db.select().from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, wakeupAfter.runId!))
      .then((rows) => rows[0]);
    expect(continuationRunAfter).toMatchObject({
      status: "cancelled",
      errorCode: "task_no_longer_eligible",
    });
    await expect(service.answer(companyId, openQuestion.id, { userId }, {
      answer: { text: "Too late." },
      expectedVersion: openAfter.version,
      idempotencyKey: "answer-after-close",
    })).rejects.toThrow(/not open|terminal|no longer active/i);
  });
});
