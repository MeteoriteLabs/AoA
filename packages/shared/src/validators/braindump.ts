import { z } from "zod";

/** WS6 — content-size cap enforced at capture time (DB write). This is
 *  larger than the prompt-injection cap (BRAINDUMP_CONTENT_PROMPT_CAP=12000
 *  in server/.../aoa-trigger-prompt.ts) — the full text is stored even
 *  though only the head of it is ever injected into a single wakeup prompt. */
export const BRAINDUMP_CONTENT_MAX_LENGTH = 20000;

export const submitBraindumpSchema = z.object({
  departmentId: z.string().uuid(),
  content: z.string().trim().min(1).max(BRAINDUMP_CONTENT_MAX_LENGTH),
  idempotencyKey: z.string().min(1).max(200),
});

export type SubmitBraindump = z.infer<typeof submitBraindumpSchema>;
