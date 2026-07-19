import { useEffect, useRef, useState } from "react";
import { projectsApi } from "../../api/projects";
import { agentsApi } from "../../api/agents";
import { setFirstRunCompleted } from "../../api/onboarding";
import { DefineDepartments } from "./DefineDepartments";
import { IntegrationsStep } from "./IntegrationsStep";
import { BraindumpStep } from "./BraindumpStep";
import { LibrarianStep } from "./LibrarianStep";
import { CreateAgents } from "./CreateAgents";
import { FirstJobStep } from "./FirstJobStep";

/** Fixed order (WS9 spec): Departments -> Integrations -> Braindump ->
 * Librarian -> CreateAgents -> FirstJob. */
export const IN_FLIGHT_SURFACES = [
  "departments",
  "integrations",
  "braindump",
  "librarian",
  "agents",
  "first_job",
] as const;
export type InFlightSurface = (typeof IN_FLIGHT_SURFACES)[number];

export type InFlightFlowProps = {
  companyId: string;
  /** Fired once, after the FINAL surface's onDone AND `setFirstRunCompleted`
   * has resolved — the caller (`FirstRunHome`) hands off to steady Home. */
  onDone: () => void;
};

/**
 * WS9 — the In-flight persona-tail sequencer. Home-hosted (WS0c §5), NOT a
 * `FlowEngine` step: each surface below does its own domain writes and never
 * calls `advanceOnboarding`.
 *
 * Data-driven resume (best-effort, WS0c §5 — "don't block on perfect
 * resume"; the reserved Phase-2 `OnboardingState` gates are deliberately NOT
 * used here): on mount, checks only the two ambient signals that are
 * unambiguous —
 *  - the company already has >=1 department -> Departments is done, start
 *    at Integrations;
 *  - the company ALSO already has >=1 org agent -> everything through
 *    CreateAgents is treated as done (a founder who reached agent-creation
 *    already passed through Integrations/Braindump/Librarian in a real
 *    run), start at FirstJob.
 * Integrations/Braindump/Librarian/FirstJob have no equally clean signal of
 * their own yet (a connected GitHub install, a braindump capture, or a
 * created task could equally be pre-existing, non-onboarding data) so they
 * are never independently skipped — a founder who already did them just
 * clicks Continue/Skip quickly on resume.
 */
export function InFlightFlow({ companyId, onDone }: InFlightFlowProps) {
  const [index, setIndex] = useState<number | null>(null);
  const doneFiredRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let start = 0;
      try {
        const [projects, agents] = await Promise.all([
          projectsApi.list(companyId).catch(() => []),
          agentsApi.list(companyId).catch(() => []),
        ]);
        const hasDepartment = (projects as { type?: string }[]).some((p) => p.type === "department");
        const hasOrgAgent = (agents as { kind?: string }[]).some((a) => a.kind === "org");
        if (hasDepartment && hasOrgAgent) {
          start = IN_FLIGHT_SURFACES.indexOf("first_job");
        } else if (hasDepartment) {
          start = IN_FLIGHT_SURFACES.indexOf("integrations");
        }
      } catch {
        // Best-effort resume — fall back to the top of the sequence.
        start = 0;
      }
      if (!cancelled) setIndex(start);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  function advance() {
    setIndex((current) => {
      const next = (current ?? 0) + 1;
      if (next >= IN_FLIGHT_SURFACES.length) {
        if (!doneFiredRef.current) {
          doneFiredRef.current = true;
          void setFirstRunCompleted(companyId).then(onDone);
        }
        return current;
      }
      return next;
    });
  }

  if (index === null) return null;

  switch (IN_FLIGHT_SURFACES[index]) {
    case "departments":
      return <DefineDepartments companyId={companyId} onDone={advance} />;
    case "integrations":
      return <IntegrationsStep companyId={companyId} onDone={advance} />;
    case "braindump":
      return <BraindumpStep companyId={companyId} onDone={advance} />;
    case "librarian":
      return <LibrarianStep companyId={companyId} onDone={advance} />;
    case "agents":
      return <CreateAgents companyId={companyId} onDone={advance} />;
    case "first_job":
      return <FirstJobStep companyId={companyId} onDone={advance} />;
    default:
      return null;
  }
}
