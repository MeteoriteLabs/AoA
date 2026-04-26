import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RoutineVariable } from "@armyofagents/shared";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variables: RoutineVariable[];
  onConfirm: (overrides: Record<string, string>) => void;
  /**
   * Optional name of the routine for context in the dialog title.
   */
  routineLabel?: string;
}

export function RoutineRunVariablesDialog({
  open,
  onOpenChange,
  variables,
  onConfirm,
  routineLabel,
}: Props) {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setValues(
        Object.fromEntries(
          variables.map((v) => [v.name, v.defaultValue != null ? String(v.defaultValue) : ""]),
        ),
      );
    }
  }, [open, variables]);

  const handleSubmit = () => {
    onConfirm(values);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Run routine{routineLabel ? `: ${routineLabel}` : ""}
          </DialogTitle>
          <DialogDescription>
            Set values for this run. Defaults are pre-filled; override any field.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {variables.length === 0 ? (
            <p className="text-sm text-muted-foreground">This routine has no variables.</p>
          ) : (
            variables.map((v) => (
              <div key={v.name} className="space-y-1.5">
                <Label htmlFor={`var-${v.name}`}>
                  {v.label ?? v.name}
                  {v.required ? <span className="text-destructive"> *</span> : null}
                </Label>
                <Input
                  id={`var-${v.name}`}
                  value={values[v.name] ?? ""}
                  onChange={(e) =>
                    setValues((s) => ({ ...s, [v.name]: e.target.value }))
                  }
                />
              </div>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Run</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
