import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MergeDiffPane } from "./MergeDiffPane";
import { useToast } from "@/context/ToastContext";
import type { SectionDiff } from "./types.js";

interface DiffResponse {
  diff: SectionDiff[];
  currentVersion: string;
  latestVersion: string;
}

interface SnapshotUpdateModalProps {
  open: boolean;
  onClose: () => void;
  companyId: string;
  updateId: string;
  itemName: string;
}

export function SnapshotUpdateModal({
  open,
  onClose,
  companyId,
  updateId,
  itemName,
}: SnapshotUpdateModalProps) {
  const qc = useQueryClient();
  const { pushToast } = useToast();
  const [decisions, setDecisions] = useState<Record<string, "mine" | "theirs">>({});

  const { data: diffData, isLoading } = useQuery<DiffResponse>({
    queryKey: ["marketplace", "updates", updateId, "diff"],
    queryFn: async () => {
      const res = await fetch(
        `/api/companies/${companyId}/marketplace/updates/${updateId}/diff`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load diff");
      return res.json() as Promise<DiffResponse>;
    },
    enabled: open,
  });

  const apply = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/companies/${companyId}/marketplace/updates/${updateId}/merge`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decisions }),
        },
      );
      if (!res.ok) throw new Error("Merge failed");
    },
    onSuccess: () => {
      pushToast({ title: "Update applied", tone: "success" });
      qc.invalidateQueries({ queryKey: ["marketplace", "updates", companyId] });
      onClose();
    },
    onError: (err: Error) => {
      pushToast({ title: "Failed to apply merge", body: err.message, tone: "error" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Review update — {itemName}</DialogTitle>
          <DialogDescription>
            {diffData
              ? `${diffData.currentVersion} → ${diffData.latestVersion}. Choose which version of each section to keep.`
              : "Loading diff…"}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <p className="text-sm text-muted-foreground py-4">Loading changes…</p>
        )}

        {diffData && (
          <MergeDiffPane
            sections={diffData.diff}
            onChange={setDecisions}
          />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => apply.mutate()}
            disabled={apply.isPending || isLoading || !diffData}
          >
            {apply.isPending ? "Applying…" : "Apply merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
