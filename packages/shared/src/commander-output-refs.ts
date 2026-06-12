// Commander viewer output refs (P1 design v2 §3a).
// A ref is a presentation pointer (ID + label) — never content, never a
// capability grant. Computed in the MCP bridge, transported in the tool
// result envelope, persisted on internal_agent_messages.output_refs.
import { z } from "zod";

export const COMMANDER_OUTPUT_REF_KINDS = ["artifact"] as const;
export type CommanderOutputRefKind = (typeof COMMANDER_OUTPUT_REF_KINDS)[number];

export const MAX_OUTPUT_REFS_PER_MESSAGE = 20;
export const MAX_OUTPUT_REF_TITLE_LENGTH = 200;

export interface CommanderOutputRef {
  v: 1;
  kind: CommanderOutputRefKind;
  id: string;
  versionId?: string | null;
  versionNumber?: number | null;
  title?: string | null;
  action: "created" | "referenced";
  toolCallId?: string | null;
  mimeType?: string | null;
}

export const commanderOutputRefSchema = z.object({
  v: z.literal(1),
  kind: z.enum(COMMANDER_OUTPUT_REF_KINDS),
  id: z.string().min(1),
  versionId: z.string().nullish(),
  versionNumber: z.number().int().positive().nullish(),
  title: z.string().max(MAX_OUTPUT_REF_TITLE_LENGTH).nullish(),
  action: z.enum(["created", "referenced"]),
  toolCallId: z.string().nullish(),
  mimeType: z.string().nullish(),
});

export const commanderOutputRefsSchema = z
  .array(commanderOutputRefSchema)
  .max(MAX_OUTPUT_REFS_PER_MESSAGE);
