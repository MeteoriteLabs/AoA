import {
  AlertCircle,
  Bell,
  Bot,
  CheckSquare,
  FileQuestion,
  GitPullRequest,
  Lightbulb,
  MessageSquare,
  Rocket,
  ShieldQuestion,
  Sparkles,
  UserPlus,
} from "lucide-react";
import {
  HUB_SEMANTIC_TO_LANE,
  HUB_SEMANTIC_TYPES,
  type HubSemanticType,
} from "@armyofagents/shared";
import type { HubItemListRow } from "@/api/hub-items";
import type { HubRegistryEntry } from "./hubTypes";

const source = (item: HubItemListRow) => item.sourceId;
const sourceLink = (prefix: string) => (item: HubItemListRow) =>
  source(item) ? `${prefix}/${source(item)}` : null;

export const HUB_REGISTRY: Record<HubSemanticType, HubRegistryEntry> = {
  approval_request: {
    semanticType: "approval_request",
    lane: HUB_SEMANTIC_TO_LANE.approval_request,
    label: "Approval",
    icon: ShieldQuestion,
    viewerKind: "approval",
    fullLink: sourceLink("/approvals"),
  },
  discussion_pending: {
    semanticType: "discussion_pending",
    lane: HUB_SEMANTIC_TO_LANE.discussion_pending,
    label: "Discussion",
    icon: MessageSquare,
    viewerKind: "discussion",
    fullLink: sourceLink("/discussions"),
  },
  join_request: {
    semanticType: "join_request",
    lane: HUB_SEMANTIC_TO_LANE.join_request,
    label: "Join request",
    icon: UserPlus,
    viewerKind: "notification",
    fullLink: () => null,
  },
  human_input_needed: {
    semanticType: "human_input_needed",
    lane: HUB_SEMANTIC_TO_LANE.human_input_needed,
    label: "Needs input",
    icon: FileQuestion,
    viewerKind: "discussion",
    fullLink: sourceLink("/discussions"),
  },
  scope_proposal: {
    semanticType: "scope_proposal",
    lane: HUB_SEMANTIC_TO_LANE.scope_proposal,
    label: "Scope proposal",
    icon: GitPullRequest,
    viewerKind: "discussion",
    fullLink: sourceLink("/discussions"),
  },
  agent_runtime_decision: {
    semanticType: "agent_runtime_decision",
    lane: HUB_SEMANTIC_TO_LANE.agent_runtime_decision,
    label: "Runtime decision",
    icon: Bot,
    viewerKind: "reserved",
    fullLink: () => null,
  },
  run_failed: {
    semanticType: "run_failed",
    lane: HUB_SEMANTIC_TO_LANE.run_failed,
    label: "Run failed",
    icon: AlertCircle,
    viewerKind: "notification",
    fullLink: () => null,
  },
  budget_alert: {
    semanticType: "budget_alert",
    lane: HUB_SEMANTIC_TO_LANE.budget_alert,
    label: "Budget",
    icon: AlertCircle,
    viewerKind: "notification",
    fullLink: () => "/settings?tab=budget",
  },
  agent_error: {
    semanticType: "agent_error",
    lane: HUB_SEMANTIC_TO_LANE.agent_error,
    label: "Agent error",
    icon: AlertCircle,
    viewerKind: "notification",
    fullLink: () => "/agents/all",
  },
  mention: {
    semanticType: "mention",
    lane: HUB_SEMANTIC_TO_LANE.mention,
    label: "Mention",
    icon: Bell,
    viewerKind: "notification",
    fullLink: () => null,
  },
  marketplace_op: {
    semanticType: "marketplace_op",
    lane: HUB_SEMANTIC_TO_LANE.marketplace_op,
    label: "Marketplace",
    icon: Sparkles,
    viewerKind: "notification",
    fullLink: () => null,
  },
  run_complete: {
    semanticType: "run_complete",
    lane: HUB_SEMANTIC_TO_LANE.run_complete,
    label: "Run complete",
    icon: CheckSquare,
    viewerKind: "notification",
    fullLink: () => null,
  },
  reminder: {
    semanticType: "reminder",
    lane: HUB_SEMANTIC_TO_LANE.reminder,
    label: "Reminder",
    icon: Bell,
    viewerKind: "notification",
    fullLink: () => "/commander",
  },
  extraction_failed: {
    semanticType: "extraction_failed",
    lane: HUB_SEMANTIC_TO_LANE.extraction_failed,
    label: "Extraction failed",
    icon: AlertCircle,
    viewerKind: "notification",
    fullLink: sourceLink("/discussions"),
  },
  routine_outcome: {
    semanticType: "routine_outcome",
    lane: HUB_SEMANTIC_TO_LANE.routine_outcome,
    label: "Routine",
    icon: Rocket,
    viewerKind: "notification",
    fullLink: sourceLink("/routines"),
  },
  legacy_other: {
    semanticType: "legacy_other",
    lane: HUB_SEMANTIC_TO_LANE.legacy_other,
    label: "Notification",
    icon: Bell,
    viewerKind: "notification",
    fullLink: () => null,
  },
  suggestion: {
    semanticType: "suggestion",
    lane: HUB_SEMANTIC_TO_LANE.suggestion,
    label: "Suggestion",
    icon: Lightbulb,
    viewerKind: "suggestion",
    fullLink: () => "/home",
  },
  stale_work: {
    semanticType: "stale_work",
    lane: HUB_SEMANTIC_TO_LANE.stale_work,
    label: "Stale task",
    icon: CheckSquare,
    viewerKind: "task",
    fullLink: sourceLink("/issues"),
  },
  proactive: {
    semanticType: "proactive",
    lane: HUB_SEMANTIC_TO_LANE.proactive,
    label: "Proactive",
    icon: Sparkles,
    viewerKind: "suggestion",
    fullLink: () => "/commander",
  },
};

const semanticTypeSet = new Set<string>(HUB_SEMANTIC_TYPES);

export function resolveHubEntry(value: string): HubRegistryEntry | null {
  if (!semanticTypeSet.has(value)) return null;
  return HUB_REGISTRY[value as HubSemanticType] ?? null;
}
