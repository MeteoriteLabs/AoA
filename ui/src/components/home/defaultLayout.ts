import type { UserRole } from "@armyofagents/shared";
import type { WidgetKey } from "./widgets/types";

// Plan 2: role-aware default boards. Founder/team_lead get the full oversight
// board (incl. Budget + Approvals); members get an execution-weighted subset.
// Data stays team-visible either way (2026-07-29 decision) — this is
// arrangement-only, not data-gating.
const FOUNDER: WidgetKey[] = ["action-queue", "approvals", "agents-now", "activity-feed", "objectives", "suggestions", "my-tasks", "budget"];
const MEMBER: WidgetKey[] = ["my-tasks", "action-queue", "objectives", "activity-feed", "suggestions", "agents-now"];

// Only team_member gets the execution board; founder, team_lead, null, and
// instance-admin (null role) all get the oversight board.
export function getDefaultLayout(role: UserRole | null): WidgetKey[] {
  return role === "team_member" ? MEMBER : FOUNDER;
}
