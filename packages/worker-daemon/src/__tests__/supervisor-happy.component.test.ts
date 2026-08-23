import { describe, expect, it } from "vitest";

import { verifyWorkerEventDigestV1 } from "@armyofagents/worker-protocol";

import { createMetrics } from "../metrics/metrics.js";
import { createFakeSandboxProvider } from "./support/fake-provider.js";
import { createSupervisor } from "../supervisor/supervisor.js";
import { collectingSink, makeHandoff, SUPERVISOR_IDENTITY } from "./support/supervisor-fixtures.js";
import { sha256hex } from "./support/poll-fixtures.js";

describe("supervisor-happy.component — create → execute (inside) → terminal → destroy under effect authority", () => {
  it("drives the full lifecycle, runs the tenant command INSIDE the sandbox, and destroys it", async () => {
    const fake = createFakeSandboxProvider();
    const sink = collectingSink();
    const metrics = createMetrics();
    const supervisor = createSupervisor({ provider: fake, identity: SUPERVISOR_IDENTITY, eventSink: sink, metrics });

    await supervisor.accept(makeHandoff());
    expect(supervisor.activeRunCount()).toBe(0);

    expect(fake.callCount("create")).toBe(1);
    expect(fake.callCount("execute")).toBe(1);
    expect(fake.callCount("destroy")).toBe(1);

    // The tenant command ran INSIDE the sandbox (recorded against the sandboxId).
    const sandboxId = fake.calls().find((c) => c.op === "create")?.sandboxId;
    expect(sandboxId).toBeTruthy();
    expect(fake.executionsOf(sandboxId!)).toEqual([{ command: "codex", args: ["exec", "--json"], insideSandbox: true }]);
    // After a happy run the sandbox is destroyed (reclaimed under effect authority).
    expect(fake.peek(sandboxId!)?.state).toBe("destroyed");

    // The ordered op sequence: create → execute → destroy (destroy under effect).
    const ops = fake.calls().filter((c) => !c.replayed).map((c) => c.op);
    expect(ops).toEqual(["create", "execute", "destroy"]);
  });

  it("emits contiguous, digest-valid attempt_started + terminal(succeeded) events carrying sandbox identity", async () => {
    const fake = createFakeSandboxProvider();
    const sink = collectingSink();
    const supervisor = createSupervisor({ provider: fake, identity: SUPERVISOR_IDENTITY, eventSink: sink });

    await supervisor.accept(makeHandoff());

    expect(sink.events.map((e) => e.eventType)).toEqual(["attempt_started", "terminal"]);
    // Contiguous seq starting at 1.
    expect(sink.events.map((e) => e.seq)).toEqual([1, 2]);
    // attempt_started carries the sandbox identity.
    const started = sink.events[0];
    expect(started.eventType).toBe("attempt_started");
    if (started.eventType === "attempt_started") {
      expect(started.payload.sandboxId).toMatch(/^fake-sbx-/);
    }
    const terminal = sink.events[1];
    expect(terminal.eventType).toBe("terminal");
    if (terminal.eventType === "terminal") {
      expect(terminal.payload.status).toBe("succeeded");
      expect(terminal.payload.exitCode).toBe(0);
    }
    // Every event's digest verifies against the frozen canonicalizer.
    for (const event of sink.events) {
      expect(await verifyWorkerEventDigestV1(event, sha256hex)).toBe(true);
    }
  });

  it("records sandbox-op metrics for create/execute/destroy with closed-set tokens", async () => {
    const fake = createFakeSandboxProvider();
    const metrics = createMetrics();
    const supervisor = createSupervisor({ provider: fake, identity: SUPERVISOR_IDENTITY, eventSink: collectingSink(), metrics });
    await supervisor.accept(makeHandoff());
    const rendered = metrics.renderPrometheus();
    expect(rendered).toContain('sandbox_op{operation="create",outcome="success"}');
    expect(rendered).toContain('sandbox_op{operation="execute",outcome="success"}');
    expect(rendered).toContain('sandbox_op{operation="destroy",outcome="success"}');
  });
});
