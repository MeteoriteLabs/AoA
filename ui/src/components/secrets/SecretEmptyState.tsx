import { CloudDownload, KeyRound, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SecretEmptyStateProps {
  onAddSecret?: () => void;
  onImportFromVault?: () => void;
}

export function SecretEmptyState({ onAddSecret, onImportFromVault }: SecretEmptyStateProps) {
  return (
    <div className="rounded-md border border-border bg-card px-5 py-8 text-center">
      <KeyRound className="mx-auto mb-3 size-7 text-muted-foreground/40" />
      <h3 className="text-sm font-semibold text-foreground">No secrets yet</h3>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
        Add encrypted values or hidden runtime references for agents, environments, and integrations.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <Button type="button" size="sm" onClick={onAddSecret}>
          <Plus className="size-3.5" />
          Add first secret
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onImportFromVault}>
          <CloudDownload className="size-3.5" />
          Import from vault
        </Button>
      </div>
    </div>
  );
}
