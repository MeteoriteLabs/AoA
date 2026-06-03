import type { NormalizedCommanderContextScope } from "./context-scope.js";

export type CommanderMemoryMode = "automatic_context" | "explicit_query";

export interface CommanderMemoryCandidate {
  id: string;
  layer?: string | null;
  status?: string | null;
  visibility?: string | null;
  expiresAt?: Date | string | null;
  departmentId?: string | null;
  projectId?: string | null;
  goalId?: string | null;
  taskId?: string | null;
  conversationId?: string | null;
  createdBy?: string | null;
}

export interface CommanderMemoryPolicyInput<T extends CommanderMemoryCandidate> {
  items: T[];
  userRole?: string | null;
  userId: string;
  scope: Partial<NormalizedCommanderContextScope>;
  mode: CommanderMemoryMode;
  now?: Date;
}

function isFounder(userRole: string | null | undefined): boolean {
  return userRole === "founder";
}

function isTeamLead(userRole: string | null | undefined): boolean {
  return userRole === "team_lead";
}

function isExpired(item: CommanderMemoryCandidate, now: Date): boolean {
  if (!item.expiresAt) return false;
  const expiresAt = item.expiresAt instanceof Date ? item.expiresAt : new Date(item.expiresAt);
  return Number.isFinite(expiresAt.getTime()) && expiresAt <= now;
}

function matchesScope(item: CommanderMemoryCandidate, scope: Partial<NormalizedCommanderContextScope>): boolean {
  if (item.conversationId) return item.conversationId === scope.conversationId;
  if (item.taskId) return item.taskId === scope.taskId;
  if (item.goalId) return item.goalId === scope.goalId;
  if (item.projectId) return item.projectId === scope.projectId;
  if (item.departmentId) return item.departmentId === scope.departmentId;
  return false;
}

function hasScope(item: CommanderMemoryCandidate): boolean {
  return Boolean(item.conversationId || item.taskId || item.goalId || item.projectId || item.departmentId);
}

function canSeeWorkingMemory<T extends CommanderMemoryCandidate>(
  item: T,
  input: CommanderMemoryPolicyInput<T>,
): boolean {
  if (isFounder(input.userRole)) return true;

  const currentScopeMatch = matchesScope(item, input.scope);
  if (input.mode === "automatic_context") return currentScopeMatch;

  return currentScopeMatch || item.createdBy === input.userId;
}

function canSeeDurableMemory<T extends CommanderMemoryCandidate>(
  item: T,
  input: CommanderMemoryPolicyInput<T>,
): boolean {
  if (isFounder(input.userRole)) return true;
  if (item.layer === "identity" && !isTeamLead(input.userRole)) return false;
  if (item.visibility === "shared") return true;
  if (!hasScope(item)) return isTeamLead(input.userRole);
  return matchesScope(item, input.scope);
}

export function filterCommanderMemoryItems<T extends CommanderMemoryCandidate>(
  input: CommanderMemoryPolicyInput<T>,
): T[] {
  const now = input.now ?? new Date();
  return input.items.filter((item) => {
    if (item.status !== "approved") return false;
    if (isExpired(item, now)) return false;
    if (item.layer === "working") return canSeeWorkingMemory(item, input);
    return canSeeDurableMemory(item, input);
  });
}

export function splitCommanderMemoryItems<T extends CommanderMemoryCandidate>(
  input: CommanderMemoryPolicyInput<T>,
): { shown: T[]; filtered: T[] } {
  const shown = filterCommanderMemoryItems(input);
  const shownIds = new Set(shown.map((item) => item.id));
  return {
    shown,
    filtered: input.items.filter((item) => !shownIds.has(item.id)),
  };
}
