import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface MemoryScopedSearchProps {
  value: string;
  onChange: (v: string) => void;
}

/**
 * Top-bar search input in the explorer. Scoped to the current folder —
 * filters the file list incrementally. Use ⌘K for global search instead.
 */
export function MemoryScopedSearch({ value, onChange }: MemoryScopedSearchProps) {
  return (
    <div className="relative w-72">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search this folder…"
        className="pl-8 pr-8 h-7 text-xs"
      />
      {value && (
        <Button
          size="icon"
          variant="ghost"
          onClick={() => onChange("")}
          className="absolute right-0.5 top-1/2 -translate-y-1/2 h-6 w-6"
          aria-label="Clear search"
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
