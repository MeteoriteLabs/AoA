import type { UIAdapterModule } from "./types";
import { claudeLocalUIAdapter } from "./claude-local";
import { codexLocalUIAdapter } from "./codex-local";
import { cursorLocalUIAdapter } from "./cursor";
import { openCodeLocalUIAdapter } from "./opencode-local";
import { openClawUIAdapter } from "./openclaw";
import { processUIAdapter } from "./process";
import { httpUIAdapter } from "./http";

const adaptersByType = new Map<string, UIAdapterModule>(
  [claudeLocalUIAdapter, codexLocalUIAdapter, openCodeLocalUIAdapter, cursorLocalUIAdapter, openClawUIAdapter, processUIAdapter, httpUIAdapter].map((a) => [a.type, a]),
);

// API adapters return plain text — reuse processUIAdapter behavior
adaptersByType.set("claude_api", processUIAdapter);
adaptersByType.set("openai_api", processUIAdapter);
adaptersByType.set("gemini_api", processUIAdapter);

export function getUIAdapter(type: string): UIAdapterModule {
  return adaptersByType.get(type) ?? processUIAdapter;
}
