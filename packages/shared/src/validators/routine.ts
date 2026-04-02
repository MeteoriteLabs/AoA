import { z } from "zod";
import {
  ROUTINE_STATUSES,
  ROUTINE_CONCURRENCY_POLICIES,
  ROUTINE_CATCH_UP_POLICIES,
  ROUTINE_TRIGGER_KINDS,
  ROUTINE_TRIGGER_SIGNING_MODES,
  ROUTINE_RUN_SOURCES,
} from "../constants.js";

export const createRoutineSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  goalId: z.string().uuid().nullable().optional(),
  parentIssueId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(500),
  description: z.string().max(10000).nullable().optional(),
  assigneeAgentId: z.string().uuid(),
  priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
  status: z.enum(ROUTINE_STATUSES).optional(),
  concurrencyPolicy: z.enum(ROUTINE_CONCURRENCY_POLICIES).optional(),
  catchUpPolicy: z.enum(ROUTINE_CATCH_UP_POLICIES).optional(),
});

export const updateRoutineSchema = createRoutineSchema.partial();

const scheduleCreateSchema = z.object({
  kind: z.literal("schedule"),
  label: z.string().max(200).nullable().optional(),
  cronExpression: z.string().min(1),
  timezone: z.string().optional(),
});

const webhookCreateSchema = z.object({
  kind: z.literal("webhook"),
  label: z.string().max(200).nullable().optional(),
  signingMode: z.enum(ROUTINE_TRIGGER_SIGNING_MODES).optional(),
  replayWindowSec: z.number().int().min(0).max(86400).optional(),
});

const apiCreateSchema = z.object({
  kind: z.literal("api"),
  label: z.string().max(200).nullable().optional(),
});

export const createRoutineTriggerSchema = z.discriminatedUnion("kind", [
  scheduleCreateSchema,
  webhookCreateSchema,
  apiCreateSchema,
]);

export const updateRoutineTriggerSchema = z.object({
  label: z.string().max(200).nullable().optional(),
  enabled: z.boolean().optional(),
  cronExpression: z.string().min(1).optional(),
  timezone: z.string().optional(),
  signingMode: z.enum(ROUTINE_TRIGGER_SIGNING_MODES).optional(),
  replayWindowSec: z.number().int().min(0).max(86400).optional(),
});

export const runRoutineSchema = z.object({
  triggerId: z.string().uuid().optional(),
  payload: z.record(z.unknown()).optional(),
  idempotencyKey: z.string().max(200).optional(),
  source: z.enum(ROUTINE_RUN_SOURCES).optional(),
});

export const rotateRoutineTriggerSecretSchema = z.object({});

export type CreateRoutine = z.infer<typeof createRoutineSchema>;
export type UpdateRoutine = z.infer<typeof updateRoutineSchema>;
export type CreateRoutineTrigger = z.infer<typeof createRoutineTriggerSchema>;
export type UpdateRoutineTrigger = z.infer<typeof updateRoutineTriggerSchema>;
export type RunRoutine = z.infer<typeof runRoutineSchema>;
