import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogBody,
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
  /** Skill updates only. Binds Apply to the exact local/upstream bytes reviewed. */
  snapshotToken?: string;
  /**
   * Agent updates only. True when the installed bundle already matches the
   * catalog byte-for-byte — the common shape of the `instructions_customized
   * IS NULL` backlog, where the row was only ever "unknown provenance" and
   * there is in fact nothing of the founder's in the way.
   */
  identical?: boolean;
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
          body: JSON.stringify({ decisions, snapshotToken: diffData?.snapshotToken }),
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

        <DialogBody className="px-0 py-4">
          {isLoading && (
            <p className="text-sm text-muted-foreground px-7">Loading changes…</p>
          )}

          {diffData?.identical && (
            <p className="px-7 pb-3 text-sm text-muted-foreground">
              No local changes found — applying this update keeps nothing back.
            </p>
          )}

          {diffData && (
            <MergeDiffPane
              sections={diffData.diff}
              onChange={setDecisions}
            />
          )}
        </DialogBody>

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
