import { z } from "zod";

export const WORK_QUESTION_STATUSES = ["open", "answered", "cancelled"] as const;
export type WorkQuestionStatus = (typeof WORK_QUESTION_STATUSES)[number];

export const WORK_QUESTION_RUN_KINDS = ["heartbeat", "internal_agent"] as const;
export type WorkQuestionRunKind = (typeof WORK_QUESTION_RUN_KINDS)[number];

export const WORK_QUESTION_CONTINUATION_STATUSES = [
  "not_needed",
  "pending",
  "dispatched",
  "failed",
] as const;
export type WorkQuestionContinuationStatus =
  (typeof WORK_QUESTION_CONTINUATION_STATUSES)[number];

export const workQuestionOptionSchema = z
  .object({
    label: z.string().trim().min(1).max(240),
    value: z.string().trim().min(1).max(500),
    description: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

export type WorkQuestionOption = z.infer<typeof workQuestionOptionSchema>;

export const workQuestionAnswerSchema = z
  .object({
    text: z.string().trim().min(1).max(8000).optional(),
    selectedValues: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.text || value.selectedValues?.length), {
    message: "An answer must include text or at least one selected value",
  });

export type WorkQuestionAnswer = z.infer<typeof workQuestionAnswerSchema>;

export interface WorkQuestion {
  id: string;
  companyId: string;
  issueId: string;
  askingAgentId: string;
  originatingRunKind: WorkQuestionRunKind | null;
  originatingRunId: string | null;
  executionWorkspaceId: string | null;
  sourceDiscussionId: string | null;
  sourceDiscussionEntryId: string | null;
  primaryRecipientUserId: string;
  currentRecipientUserId: string;
  title: string;
  question: string;
  context: Record<string, unknown> | null;
  options: WorkQuestionOption[] | null;
  blocking: boolean;
  status: WorkQuestionStatus;
  answer: WorkQuestionAnswer | null;
  answeredByUserId: string | null;
  answeredAt: Date | null;
  continuationStatus: WorkQuestionContinuationStatus;
  continuationRunKind: WorkQuestionRunKind | null;
  continuationRunId: string | null;
  continuationError: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export const answerWorkQuestionSchema = z
  .object({
    answer: workQuestionAnswerSchema,
    expectedVersion: z.number().int().nonnegative(),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();

export type AnswerWorkQuestionInput = z.infer<typeof answerWorkQuestionSchema>;
