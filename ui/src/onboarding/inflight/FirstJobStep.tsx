import { useEffect, useRef, useState } from "react";
import { issuesApi } from "../../api/issues";
import { discussionsApi } from "../../api/discussions";
import { agentsApi } from "../../api/agents";
import { Button } from "@/components/ui/button";
import { Reveal } from "../motion";
import { FIELD, GradientText, LABEL, StepCard, StepHeading, StepShell } from "../steps/shared";

type AgentRow = { id: string; kind?: string; name?: string; status?: string };

type CardStatus = "idle" | "creating" | "created" | "error";

export type FirstJobStepProps = {
  companyId: string;
  onDone: () => void;
};

/**
 * WS8 — the In-flight "First job" surface (mockup S7f). Standalone, like
 * `DefineDepartments` (WS4) and `CreateAgents` (WS7): domain-only, no
 * `advanceOnboarding` call — WS9 wires this onto Home later.
 *
 * Two independent paths, side by side — either one counts as "a first job":
 *  - **Create a task**, optionally assigned to one of the company's org
 *    agents (`issuesApi.create`). The assignee picker is populated from
 *    `agentsApi.list`, filtered to `kind !== "aoa"` (org agents — the ones
 *    the founder just hired in WS7 — not the hidden internal crew); if there
 *    are none yet, the picker still works with only "Unassigned".
 *  - **Start a discussion** (`discussionsApi.create`), just a topic.
 *
 * Both are optional — this is a reward, not a wall: "Skip to Home" always
 * works, with nothing required and nothing created. `onDone` fires the
 * first time EITHER path succeeds, or when Skip is pressed — guarded via
 * `fireOnDoneOnce` so a rapid double-submit (same card twice, or both cards
 * in quick succession) only ever calls it once.
 */
export function FirstJobStep({ companyId, onDone }: FirstJobStepProps) {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  const [taskTitle, setTaskTitle] = useState("");
  const [taskAssigneeId, setTaskAssigneeId] = useState("");
  const [taskStatus, setTaskStatus] = useState<CardStatus>("idle");
  const [taskError, setTaskError] = useState<string | null>(null);

  const [discussionTitle, setDiscussionTitle] = useState("");
  const [discussionStatus, setDiscussionStatus] = useState<CardStatus>("idle");
  const [discussionError, setDiscussionError] = useState<string | null>(null);

  const doneFiredRef = useRef(false);
  function fireOnDoneOnce() {
    if (doneFiredRef.current) return;
    doneFiredRef.current = true;
    onDone();
  }

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    agentsApi
      .list(companyId)
      .then((list) => {
        if (cancelled) return;
        const orgAgents = (list as AgentRow[]).filter(
          (a) => a.kind !== "aoa" && a.status !== "terminated",
        );
        setAgents(orgAgents);
      })
      .catch((e) => {
        if (!cancelled) {
          setAgentsError(e instanceof Error ? e.message : "Couldn't load agents.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  async function handleCreateTask() {
    if (!taskTitle.trim() || taskStatus === "creating") return;
    setTaskStatus("creating");
    setTaskError(null);
    try {
      await issuesApi.create(companyId, {
        title: taskTitle.trim(),
        status: "todo",
        ...(taskAssigneeId ? { assigneeAgentId: taskAssigneeId } : {}),
      });
      setTaskStatus("created");
      fireOnDoneOnce();
    } catch (e) {
      setTaskStatus("error");
      setTaskError(e instanceof Error ? e.message : "Failed to create this task.");
    }
  }

  async function handleStartDiscussion() {
    if (!discussionTitle.trim() || discussionStatus === "creating") return;
    setDiscussionStatus("creating");
    setDiscussionError(null);
    try {
      await discussionsApi.create(companyId, { title: discussionTitle.trim() });
      setDiscussionStatus("created");
      fireOnDoneOnce();
    } catch (e) {
      setDiscussionStatus("error");
      setDiscussionError(e instanceof Error ? e.message : "Failed to start this discussion.");
    }
  }

  return (
    <StepShell className="max-w-2xl">
      <Reveal>
        <StepHeading
          title={
            <>
              Give it a <GradientText>first job</GradientText>
            </>
          }
          subtitle="Create a task or start a discussion — or skip straight to Home."
        />
      </Reveal>

      {agentsError && <p className="text-center text-xs text-destructive">{agentsError}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Reveal delay={0.09}>
          <StepCard>
            <h3 className="text-sm font-medium text-text">Create a task</h3>
            <div className="mt-3 space-y-2">
              <label className="sr-only" htmlFor="first-job-task-title">
                Task title
              </label>
              <input
                id="first-job-task-title"
                className={FIELD}
                placeholder="What needs doing?"
                value={taskTitle}
                disabled={taskStatus === "creating" || taskStatus === "created"}
                onChange={(e) => setTaskTitle(e.target.value)}
              />
              <div>
                <label className={LABEL} htmlFor="first-job-task-assignee">
                  Assignee
                </label>
                <select
                  id="first-job-task-assignee"
                  className={FIELD}
                  value={taskAssigneeId}
                  disabled={taskStatus === "creating" || taskStatus === "created"}
                  onChange={(e) => setTaskAssigneeId(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name ?? agent.id}
                    </option>
                  ))}
                </select>
              </div>
              {taskStatus === "error" && <p className="text-xs text-destructive">{taskError}</p>}
              <Button
                type="button"
                className="w-full"
                disabled={!taskTitle.trim() || taskStatus === "creating" || taskStatus === "created"}
                onClick={() => void handleCreateTask()}
              >
                {taskStatus === "creating"
                  ? "Creating…"
                  : taskStatus === "created"
                    ? "Created"
                    : taskStatus === "error"
                      ? "Retry"
                      : "Create task"}
              </Button>
            </div>
          </StepCard>
        </Reveal>

        <Reveal delay={0.18}>
          <StepCard>
            <h3 className="text-sm font-medium text-text">Start a discussion</h3>
            <div className="mt-3 space-y-2">
              <label className="sr-only" htmlFor="first-job-discussion-title">
                Discussion topic
              </label>
              <input
                id="first-job-discussion-title"
                className={FIELD}
                placeholder="What's on your mind?"
                value={discussionTitle}
                disabled={discussionStatus === "creating" || discussionStatus === "created"}
                onChange={(e) => setDiscussionTitle(e.target.value)}
              />
              {discussionStatus === "error" && (
                <p className="text-xs text-destructive">{discussionError}</p>
              )}
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                disabled={
                  !discussionTitle.trim() || discussionStatus === "creating" || discussionStatus === "created"
                }
                onClick={() => void handleStartDiscussion()}
              >
                {discussionStatus === "creating"
                  ? "Starting…"
                  : discussionStatus === "created"
                    ? "Started"
                    : discussionStatus === "error"
                      ? "Retry"
                      : "Start discussion"}
              </Button>
            </div>
          </StepCard>
        </Reveal>
      </div>

      <Reveal delay={0.27}>
        <Button type="button" variant="ghost" className="w-full" onClick={fireOnDoneOnce}>
          Skip to Home
        </Button>
      </Reveal>
    </StepShell>
  );
}
