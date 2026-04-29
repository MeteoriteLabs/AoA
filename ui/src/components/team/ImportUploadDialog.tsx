import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportUploadDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import team from file</DialogTitle>
          <DialogDescription>
            Coming in Slice 8 — file upload + cascade install.
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
