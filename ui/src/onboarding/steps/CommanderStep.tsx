import { useState } from "react";
import type { StepProps } from "../registry";
import { providerToCliTool, type CommanderProvider } from "@armyofagents/shared";
import { internalAgentApi } from "../../api/internal-agent";
import { advanceOnboarding } from "../../api/onboarding";
import { Button } from "@/components/ui/button";

const CARDS: { provider: CommanderProvider; label: string; desc: string }[] = [
  { provider: "anthropic", label: "Claude", desc: "Anthropic Claude Code CLI" },
  { provider: "openai", label: "Codex", desc: "OpenAI Codex CLI" },
];

/**
 * "Choose your Commander" step (Stage C / order 4). Cards, not a dropdown — no
 * model internals (scope §6). Writes the single internal_agent_config row in
 * place via PATCH (idempotent; the row is seeded at company create), then
 * advances COMMANDER_SELECTED and completes. Blank models → provider default
 * server-side. Crew inherits the same provider.
 */
export function CommanderStep({ ctx, onComplete }: StepProps) {
  const [provider, setProvider] = useState<CommanderProvider | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!ctx.companyId || !provider) return;
    setBusy(true);
    setError(null);
    try {
      await internalAgentApi.updateConfig(ctx.companyId, {
        cliTool: providerToCliTool(provider),
        provider,
        model: null,
        crewModel: null,
      });
      await advanceOnboarding({
        companyId: ctx.companyId,
        journey: ctx.journey,
        requestedState: "COMMANDER_SELECTED",
      });
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save your Commander choice.");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-10">
      <h1 className="text-xl font-semibold">Choose your Commander</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Commander is your always-on AI assistant. Pick the CLI it runs on — you can change the
        model later in Settings.
      </p>
      <div className="mt-6 grid grid-cols-2 gap-2">
        {CARDS.map((c) => (
          <button
            key={c.provider}
            type="button"
            className={`rounded-md border p-4 text-left ${
              provider === c.provider ? "border-foreground bg-accent" : "border-border hover:bg-accent/50"
            }`}
            onClick={() => setProvider(c.provider)}
          >
            <div className="text-sm font-medium">{c.label}</div>
            <div className="text-xs text-muted-foreground">{c.desc}</div>
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <Button className="mt-4 w-full" onClick={() => void submit()} disabled={busy || !provider}>
        {busy ? "Saving…" : "Continue"}
      </Button>
    </div>
  );
}
