import { ChevronDown, MessageSquare, Plus, Target } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useDialog } from "@/context/DialogContext";

/**
 * Home's compact creator menu (Plan 6 Task 1): replaces the three
 * always-visible QuickActionCard buttons that used to sit under the header
 * with a single Radix DropdownMenu trigger, mirroring Commander's
 * `InputAddMenu` (DropdownMenu > DropdownMenuTrigger asChild > Content >
 * Item onSelect=...). Every creator (New task / Discussion / New goal) stays
 * reachable — just behind one "New" trigger instead of three cards.
 */
export function NewMenu() {
  const { openNewIssue, openDiscussionCapture, openNewGoal } = useDialog();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label="Create">
          <Plus className="h-4 w-4" aria-hidden="true" />
          New
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => openNewIssue()}>
          <Plus className="size-4" aria-hidden="true" />
          New task
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openDiscussionCapture()}>
          <MessageSquare className="size-4" aria-hidden="true" />
          Discussion
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openNewGoal()}>
          <Target className="size-4" aria-hidden="true" />
          New goal
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
