import { Brain } from "lucide-react";

export function MemoryEmptyViewer() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center text-xs text-muted-foreground space-y-2">
        <Brain className="h-8 w-8 mx-auto opacity-30" />
        <div>Select an item to view it here</div>
      </div>
    </div>
  );
}
