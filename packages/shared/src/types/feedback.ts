export const FEEDBACK_DATA_SHARING_PREFERENCES = ["allowed", "not_allowed", "prompt"] as const;
export type FeedbackDataSharingPreference = (typeof FEEDBACK_DATA_SHARING_PREFERENCES)[number];

// AoA privacy-first default: "not_allowed".
// Paperclip defaults to "prompt" (asks user on first feedback action). AoA opts users out
// until they explicitly opt in. The feedback/telemetry subsystem itself lands in Phase F;
// this constant only controls the instance-settings default at Phase A.7.
export const DEFAULT_FEEDBACK_DATA_SHARING_PREFERENCE: FeedbackDataSharingPreference = "not_allowed";

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
