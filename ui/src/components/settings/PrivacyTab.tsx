import type {
  FeedbackDataSharingPreference,
  InstanceGeneralSettings,
  PatchInstanceGeneralSettings,
} from "@paperclipai/shared";
import { DEFAULT_FEEDBACK_DATA_SHARING_PREFERENCE } from "@paperclipai/shared";
import { cn } from "@/lib/utils";

interface PrivacyTabProps {
  settings: InstanceGeneralSettings | undefined;
  isLoading: boolean;
  error: unknown;
  isSaving: boolean;
  onChange: (patch: PatchInstanceGeneralSettings) => void;
}

const OPTIONS: ReadonlyArray<{
  value: FeedbackDataSharingPreference;
  label: string;
  description: string;
}> = [
  {
    value: "allowed",
    label: "Always allow",
    description: "Share voted AI outputs with Army of Agents Labs automatically.",
  },
  {
    value: "not_allowed",
    label: "Don't allow",
    description: "Keep voted AI outputs local only.",
  },
  {
    value: "prompt",
    label: "Ask each time",
    description: "Prompt on the first thumbs up or down, then remember the choice.",
  },
];

export function PrivacyTab({ settings, isLoading, error, isSaving, onChange }: PrivacyTabProps) {
  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading privacy settings...</div>;
  }
  if (error) {
    return <div className="text-sm text-destructive">Failed to load privacy settings.</div>;
  }

  const preference: FeedbackDataSharingPreference =
    settings?.feedbackDataSharingPreference ?? DEFAULT_FEEDBACK_DATA_SHARING_PREFERENCE;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Privacy</h2>
        <p className="text-sm text-muted-foreground">
          Control whether anonymized feedback data leaves this instance. AoA defaults to not sharing
          — you opt in only if you want to contribute to AI improvement.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold">AI feedback sharing</h3>
            <p className="max-w-2xl text-sm text-muted-foreground">
              When a teammate gives a thumbs up or down on an agent's output, this setting decides
              whether the voted output is sent to AoA Labs. Votes are always saved locally.
            </p>
            <p
              className="max-w-2xl rounded-md border border-amber-600/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
              role="note"
            >
              The feedback sharing subsystem is not yet wired in this build — this toggle records
              your preference but has no effect until Phase F delivers redaction and transport.
            </p>
          </div>

          <div
            role="radiogroup"
            aria-label="AI feedback sharing preference"
            className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
          >
            {OPTIONS.map((option) => {
              const active = preference === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={isSaving}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                    active
                      ? "border-foreground bg-accent text-foreground"
                      : "border-border bg-background hover:bg-accent/50",
                  )}
                  onClick={() =>
                    onChange({ feedbackDataSharingPreference: option.value })
                  }
                >
                  <div className="text-sm font-medium">{option.label}</div>
                  <div className="text-xs text-muted-foreground">{option.description}</div>
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
