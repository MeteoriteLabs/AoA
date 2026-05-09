import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { memoryApi } from "../../api/memory";
import { projectsApi } from "../../api/projects";
import { queryKeys } from "../../lib/queryKeys";
import type { Project } from "@armyofagents/shared";

// ---- constants -------------------------------------------------------

const LAYER_OPTIONS = [
  { value: "identity", label: "Identity (always in agent context)" },
  { value: "domain", label: "Domain (department-scoped)" },
  { value: "active_context", label: "Active context (goal-scoped)" },
  { value: "working", label: "Working (task-ephemeral, 7d)" },
] as const;

type LayerValue = (typeof LAYER_OPTIONS)[number]["value"];

const CATEGORY_OPTIONS = [
  { value: "decision", label: "Decision" },
  { value: "reference", label: "Reference" },
  { value: "context", label: "Context" },
  { value: "insight", label: "Insight" },
  { value: "preference", label: "Preference" },
  { value: "procedure", label: "Procedure" },
  { value: "policy", label: "Policy" },
] as const;

type CategoryValue = (typeof CATEGORY_OPTIONS)[number]["value"];

// ---- props -----------------------------------------------------------

export interface NewMemoryItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  defaultDepartmentId?: string | null;
  defaultFolderPath?: string;
}

// ---- component -------------------------------------------------------

export function NewMemoryItemDialog({
  open,
  onOpenChange,
  companyId,
  defaultDepartmentId,
  defaultFolderPath,
}: NewMemoryItemDialogProps) {
  const qc = useQueryClient();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [layer, setLayer] = useState<LayerValue>("domain");
  const [departmentId, setDepartmentId] = useState<string>("none");
  const [category, setCategory] = useState<CategoryValue>("reference");

  // Fetch departments for the department select.
  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(companyId),
    queryFn: () => projectsApi.list(companyId),
    enabled: open,
  });

  const departments: Project[] = (projects ?? []).filter(
    (p: Project) => p.type === "department",
  );

  // Reset state whenever the dialog opens, seeding from props.
  useEffect(() => {
    if (open) {
      setTitle("");
      setContent("");
      setLayer("domain");
      setDepartmentId(defaultDepartmentId ?? "none");
      setCategory("reference");
    }
  }, [open, defaultDepartmentId]);

  // Clear departmentId when layer changes away from "domain".
  function handleLayerChange(value: LayerValue) {
    setLayer(value);
    if (value !== "domain") {
      setDepartmentId("none");
    }
  }

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      memoryApi.create(companyId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.memory.list(companyId) });
      qc.invalidateQueries({ queryKey: queryKeys.memory.pending(companyId) });
      onOpenChange(false);
      resetForm();
    },
  });

  function resetForm() {
    setTitle("");
    setContent("");
    setLayer("domain");
    setDepartmentId(defaultDepartmentId ?? "none");
    setCategory("reference");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim() || createMutation.isPending) return;

    createMutation.mutate({
      title: title.trim(),
      content: content.trim(),
      layer,
      category,
      source: "founder",
      status: "approved",
      departmentId: layer === "domain" && departmentId !== "none" ? departmentId : null,
      ...(defaultFolderPath ? { folderPath: defaultFolderPath } : {}),
    });
  }

  const canSubmit =
    title.trim().length > 0 &&
    content.trim().length > 0 &&
    !createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add to Memory</DialogTitle>
          <DialogDescription className="sr-only">
            Create a new memory item
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="new-mem-title">Title</Label>
            <Input
              id="new-mem-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Memory item title"
            />
          </div>

          {/* Content */}
          <div className="space-y-1.5">
            <Label htmlFor="new-mem-content">Content</Label>
            <Textarea
              id="new-mem-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Describe the knowledge… (Markdown supported)"
              rows={4}
            />
          </div>

          {/* Layer + Category */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-mem-layer">Layer</Label>
              <Select value={layer} onValueChange={(v) => handleLayerChange(v as LayerValue)}>
                <SelectTrigger id="new-mem-layer" className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LAYER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-mem-category">Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as CategoryValue)}>
                <SelectTrigger id="new-mem-category" className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="capitalize">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Department — only when layer === "domain" */}
          {layer === "domain" && (
            <div className="space-y-1.5">
              <Label htmlFor="new-mem-dept">Department</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger id="new-mem-dept" className="h-8 text-sm">
                  <SelectValue placeholder="None (company-wide)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (company-wide)</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {createMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
