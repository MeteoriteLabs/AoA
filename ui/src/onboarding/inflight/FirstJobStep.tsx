import { useEffect, useRef, useState } from "react";
import { issuesApi } from "../../api/issues";
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
 * Task-only: **Create a task**, optionally assigned to one of the company's
 * org agents (`issuesApi.create`). The assignee picker is populated from
 * `agentsApi.list`, which already scopes to `kind: "org"` (non-terminated)
 * server-side — the ones the founder just hired in WS7, never the hidden
 * internal crew. The client-side filter below is a defensive belt-and-
 * braces guard, not the primary exclusion mechanism; if there are no
 * agents yet, the picker still works with only "Unassigned".
 *
 * Creating a task is optional — this is a reward, not a wall: "Skip to
 * Home" always works, with nothing required and nothing created. `onDone`
 * fires the first time task creation succeeds, or when Skip is pressed —
 * guarded via `fireOnDoneOnce` so a rapid double-submit only ever calls it
 * once.
 */
export function FirstJobStep({ companyId, onDone }: FirstJobStepProps) {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  const [taskTitle, setTaskTitle] = useState("");
  const [taskAssigneeId, setTaskAssigneeId] = useState("");
  const [taskStatus, setTaskStatus] = useState<CardStatus>("idle");
  const [taskError, setTaskError] = useState<string | null>(null);

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

  return (
    <StepShell>
      <Reveal>
        <StepHeading
          title={
            <>
              Give it a <GradientText>first job</GradientText>
            </>
          }
          subtitle="Give your agent its first task — or skip straight to Home."
        />
      </Reveal>

      {agentsError && <p className="text-center text-xs text-destructive">{agentsError}</p>}

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
        <Button type="button" variant="ghost" className="w-full" onClick={fireOnDoneOnce}>
          Skip to Home
        </Button>
      </Reveal>
    </StepShell>
  );
}
