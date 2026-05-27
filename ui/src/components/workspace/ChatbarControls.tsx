// ui/src/components/workspace/ChatbarControls.tsx
import { Paperclip, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shortModelName } from "./adapter-utils";

interface ChatbarControlsProps {
  adapterType: string;
  /** The agent's default model from adapterConfig */
  defaultModel: string | null;
  /** Currently selected model override */
  selectedModel: string | null;
  /**
   * Retained for caller compatibility. Sprint 2A removed the API-mode model
   * picker; CLI tools manage their own model selection. Still accepted by
   * WorkspaceTimeline so it can wire up `setModelOverride`, but not called
   * from within this component anymore. Optional from Sprint 2A onward.
   */
  onModelChange?: (model: string | null) => void;
  onSend: () => void;
  onAttach?: () => void;
  showModelLabel?: boolean;
  sendDisabled: boolean;
  sendPending: boolean;
}

export function ChatbarControls({
  adapterType,
  defaultModel,
  selectedModel,
  onSend,
  onAttach,
  showModelLabel = true,
  sendDisabled,
  sendPending,
}: ChatbarControlsProps) {
  // Sprint 2A: API adapters removed — model is read-only now; CLI tool picks
  // its own model so onModelChange is no longer wired.
  const effectiveModel = selectedModel ?? defaultModel ?? "";
  const displayModel = effectiveModel ? shortModelName(effectiveModel) : adapterType;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      {/* Left: attach + model selector */}
      <div className="flex items-center gap-1.5">
        {/* Attach button */}
        <button
          type="button"
          onClick={onAttach}
          disabled={!onAttach}
          className="p-1 hover:bg-muted/50 rounded transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          title="Attach file"
          aria-label="Attach file"
        >
          <Paperclip className="h-3.5 w-3.5" />
        </button>

        {/* Read-only model label — CLI adapters manage model selection themselves */}
        {showModelLabel && (
          <span className="text-[11px] text-muted-foreground px-1.5 py-0.5 bg-muted/40 rounded">
            {displayModel}
          </span>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: send button */}
      <Button
        size="sm"
        className="h-7 text-xs px-3"
        disabled={sendDisabled}
        onClick={onSend}
      >
        {sendPending ? (
          "Sending..."
        ) : (
          <>
            Send
            <Send className="h-3 w-3 ml-1.5" />
          </>
        )}
      </Button>
    </div>
  );
}
