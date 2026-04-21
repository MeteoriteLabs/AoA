export const FEEDBACK_DATA_SHARING_PREFERENCES = ["allowed", "not_allowed", "prompt"] as const;
export type FeedbackDataSharingPreference = (typeof FEEDBACK_DATA_SHARING_PREFERENCES)[number];

// AoA privacy-first default: "not_allowed".
// Paperclip defaults to "prompt" (asks user on first feedback action). AoA opts users out
// until they explicitly opt in. The feedback/telemetry subsystem itself lands in Phase F;
// this constant only controls the instance-settings default at Phase A.7.
export const DEFAULT_FEEDBACK_DATA_SHARING_PREFERENCE: FeedbackDataSharingPreference = "not_allowed";

// F.2 MVP ports only "issue_comment" — covers agent output comments on tasks, the primary
// feedback surface on TaskSlideOver. Paperclip also defines "issue_document_revision"
// for document revisions; deferred to Phase I polish along with artifact-version votes.
export const FEEDBACK_TARGET_TYPES = ["issue_comment"] as const;
export type FeedbackTargetType = (typeof FEEDBACK_TARGET_TYPES)[number];

export const FEEDBACK_VOTE_VALUES = ["up", "down"] as const;
export type FeedbackVoteValue = (typeof FEEDBACK_VOTE_VALUES)[number];

export interface FeedbackVote {
  id: string;
  companyId: string;
  issueId: string;
  targetType: FeedbackTargetType;
  targetId: string;
  authorUserId: string;
  vote: FeedbackVoteValue;
  reason: string | null;
  sharedWithLabs: boolean;
  sharedAt: Date | null;
  consentVersion: string | null;
  redactionSummary: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeedbackVoteSummary {
  ups: number;
  downs: number;
  total: number;
}

export type FeedbackRedactionState = {
  redactedFields: Set<string>;
  truncatedFields: Set<string>;
  omittedFields: Set<string>;
  notes: Set<string>;
  counts: Map<string, number>;
};

export type FeedbackRedactionSummary = {
  strategy: string;
  redactedFields: string[];
  truncatedFields: string[];
  omittedFields: string[];
  notes: string[];
  counts: Record<string, number>;
};
