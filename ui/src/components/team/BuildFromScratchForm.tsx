import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BuildFromScratchForm({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New team</DialogTitle>
          <DialogDescription>
            Coming in Task 2.4 — full create form with mixed agent picker.
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
