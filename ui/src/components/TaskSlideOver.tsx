import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { queryKeys } from "../lib/queryKeys";
import { issuesApi } from "../api/issues";
import { TaskDetail } from "./TaskDetail";

interface TaskSlideOverProps {
  issueId: string | null;
  open: boolean;
  onClose: () => void;
}

export function TaskSlideOver({ issueId, open, onClose }: TaskSlideOverProps) {
  // Title-only query, deduped with TaskDetail's issues.detail query (same key → one fetch).
  const { data: issue } = useQuery({
    queryKey: queryKeys.issues.detail(issueId!),
    queryFn: () => issuesApi.get(issueId!),
    enabled: !!issueId && open,
  });

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-describedby={undefined}
        className="w-[560px] sm:w-[600px] sm:max-w-[600px] p-0 gap-0 overflow-hidden flex flex-col"
        onPointerDownOutside={(event) => {
          const target = event.detail.originalEvent.target as HTMLElement | null;
          if (target?.closest("[data-radix-popper-content-wrapper]")) {
            event.preventDefault();
          }
        }}
      >
        <SheetTitle className="sr-only">
          {issue?.identifier ? `${issue.identifier}: ` : ""}
          {issue?.title ?? "Task details"}
        </SheetTitle>
        <SheetDescription className="sr-only">
          Task details, comments, and workspace actions
        </SheetDescription>
        <TaskDetail issueId={issueId} active={open} onDismiss={onClose} />
      </SheetContent>
    </Sheet>
  );
}
