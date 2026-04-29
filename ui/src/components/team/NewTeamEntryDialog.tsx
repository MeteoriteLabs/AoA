import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  initialMode: "build" | "import" | null;
  onOpenChange: (open: boolean) => void;
}

export function NewTeamEntryDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a new team</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Coming soon — Task 2.3 implements the 3-option chooser.
        </p>
      </DialogContent>
    </Dialog>
  );
}
