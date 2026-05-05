// ui/src/components/workspace/ChatbarControls.tsx
import { useQuery } from "@tanstack/react-query";
import { Paperclip, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { agentsApi } from "../../api/agents";
import { useCompany } from "../../context/CompanyContext";
import { queryKeys } from "../../lib/queryKeys";
import { isApiAdapter, shortModelName } from "./adapter-utils";

interface ChatbarControlsProps {
  adapterType: string;
  /** The agent's default model from adapterConfig */
  defaultModel: string | null;
  /** Currently selected model override */
  selectedModel: string | null;
  onModelChange: (model: string | null) => void;
  onSend: () => void;
  onAttach?: () => void;
  sendDisabled: boolean;
  sendPending: boolean;
}

export function ChatbarControls({
  adapterType,
  defaultModel,
  selectedModel,
  onModelChange,
  onSend,
  onAttach,
  sendDisabled,
  sendPending,
}: ChatbarControlsProps) {
  const { selectedCompanyId } = useCompany();
  const showModelSelector = isApiAdapter(adapterType);

  const { data: adapterModels } = useQuery({
    queryKey: queryKeys.agents.adapterModels(selectedCompanyId!, adapterType),
    queryFn: () => agentsApi.adapterModels(selectedCompanyId!, adapterType),
    enabled: !!selectedCompanyId && showModelSelector,
    staleTime: 60_000, // Models don't change often
  });

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

        {/* Model selector (API adapters only) or read-only label */}
        {showModelSelector && adapterModels && adapterModels.length > 0 ? (
          <Select
            value={effectiveModel}
            onValueChange={(val) => {
              // If they select the default, clear the override
              onModelChange(val === defaultModel ? null : val);
            }}
          >
            <SelectTrigger size="sm" className="h-6 text-[11px] border-none bg-muted/40 hover:bg-muted/60 px-2 gap-1 min-w-0 max-w-[120px]">
              <SelectValue>{displayModel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {adapterModels.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-xs">
                  {shortModelName(m.id)}
                  {m.id === defaultModel && (
                    <span className="ml-1 text-muted-foreground">(default)</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
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
