import { Paperclip, Plus, Wand2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface InputAddMenuProps {
  onUseSkill: () => void;
  disabled?: boolean;
}

export function InputAddMenu({ onUseSkill, disabled = false }: InputAddMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Add"
          className={cn(
            "size-8 rounded-full flex items-center justify-center shrink-0",
            "bg-brand text-white",
            "hover:bg-brand-hover transition-colors",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-focus-ring",
            "disabled:opacity-40 disabled:pointer-events-none",
          )}
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        <DropdownMenuItem onSelect={onUseSkill}>
          <Wand2 className="size-4" aria-hidden="true" />
          Use a skill
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <Paperclip className="size-4" aria-hidden="true" />
          <span>Attach file</span>
          <span className="ml-auto text-xs text-muted-foreground opacity-60">Coming soon</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
