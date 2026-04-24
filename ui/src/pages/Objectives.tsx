import { useEffect, useState, useMemo } from "react";
import { Link, useLocation } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Goal } from "@armyofagents/shared";
import { goalsApi } from "../api/goals";
import { companiesApi } from "../api/companies";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Target, Plus, AlertTriangle, ChevronRight, Pencil } from "lucide-react";
import { cn } from "../lib/utils";

type Tab = "goals" | "vision";

/* ── Goal card ─────────────────────────────────────────────────────── */

function GoalCard({ goal, subGoalCount }: { goal: Goal; subGoalCount: number }) {
  const isUnassigned = !goal.projects || goal.projects.length === 0;

  return (
    <Link
      to={`/goals/${goal.id}`}
      className="block rounded-lg border border-border p-4 hover:border-foreground/20 hover:shadow-md transition-all duration-150 no-underline text-inherit"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {goal.level}
          </span>
          <StatusBadge status={goal.status} />
        </div>
        {subGoalCount > 0 && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
            <ChevronRight className="h-3 w-3" />
            {subGoalCount} sub-goal{subGoalCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <h3 className="text-sm font-semibold mb-1 truncate">{goal.title}</h3>

      {goal.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
          {goal.description}
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {isUnassigned ? (
          <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 text-amber-600 px-1.5 py-0.5 text-[10px] font-medium">
            <AlertTriangle className="h-2.5 w-2.5" />
            Unassigned
          </span>
        ) : (
          goal.projects.map((p) => (
            <span
              key={p.id}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium",
                p.type === "department"
                  ? "bg-blue-500/15 text-blue-600"
                  : "bg-purple-500/15 text-purple-600",
              )}
            >
              {p.name}
            </span>
          ))
        )}
      </div>
    </Link>
  );
}

/* ── Identity card (read-only with edit button) ────────────────────── */

function IdentityCard({
  label,
  hint,
  value,
  placeholder,
  onEdit,
}: {
  label: string;
  hint: string;
  value: string;
  placeholder: string;
  onEdit: () => void;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            {label}
          </div>
          <p className="text-[11px] text-muted-foreground mb-2">{hint}</p>
          {value ? (
            <p className="text-sm whitespace-pre-line">{value}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">{placeholder}</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onEdit}
          aria-label={`Edit ${label}`}
          title={`Edit ${label}`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* ── Edit modal ────────────────────────────────────────────────────── */

function EditIdentityModal({
  open,
  onOpenChange,
  label,
  hint,
  value,
  onSave,
  saving,
  multiline,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  hint: string;
  value: string;
  onSave: (value: string) => void;
  saving: boolean;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {label}</DialogTitle>
          <DialogDescription>{hint}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {multiline ? (
            <textarea
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none resize-none focus:ring-2 focus:ring-ring"
              rows={5}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
          ) : (
            <input
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saving}
              onClick={() => onSave(draft)}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Main page ─────────────────────────────────────────────────────── */

export function Objectives() {
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { openNewGoal } = useDialog();
  const { setBreadcrumbs, setSubtitle, setEntityColor } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const location = useLocation();

  const initialTab: Tab = (() => {
    const param = new URLSearchParams(location.search).get("tab");
    return param === "vision" ? "vision" : "goals";
  })();

  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [editingField, setEditingField] = useState<"vision" | "mission" | "values" | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Objectives" }]);
    return () => {
      setSubtitle(null);
      setEntityColor(null);
    };
  }, [setBreadcrumbs, setSubtitle, setEntityColor]);

  // ── Vision / Mission save ───────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (data: { vision?: string | null; mission?: string | null; values?: string | null }) =>
      companiesApi.update(selectedCompanyId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      setEditingField(null);
    },
  });

  function handleFieldSave(field: "vision" | "mission" | "values", value: string) {
    saveMutation.mutate({ [field]: value.trim() || null });
  }

  // ── Goals ───────────────────────────────────────────────────────
  const { data: goals, isLoading: goalsLoading, error: goalsError } = useQuery({
    queryKey: queryKeys.goals.list(selectedCompanyId!),
    queryFn: () => goalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const subGoalCounts = useMemo(() => {
    if (!goals) return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const g of goals) {
      if (g.parentId) counts.set(g.parentId, (counts.get(g.parentId) ?? 0) + 1);
    }
    return counts;
  }, [goals]);

  const rootGoals = useMemo(() => {
    if (!goals) return [];
    const goalIds = new Set(goals.map((g) => g.id));
    return goals.filter((g) => !g.parentId || !goalIds.has(g.parentId));
  }, [goals]);

  // ── Render ──────────────────────────────────────────────────────

  const tabs: { key: Tab; label: string }[] = [
    { key: "goals", label: "Goals" },
    { key: "vision", label: "Vision & Mission" },
  ];

  const fieldConfig = {
    vision: {
      label: "Vision",
      hint: "Where are we headed? A single-line statement describing the future you're building toward.",
      placeholder: "Not set yet — click edit to add your vision",
      multiline: false,
    },
    mission: {
      label: "Mission",
      hint: "How do we get there? A short statement describing your approach and strategy.",
      placeholder: "Not set yet — click edit to add your mission",
      multiline: true,
    },
    values: {
      label: "Values",
      hint: "What do we stand for? Core principles that guide decisions. One per line works well.",
      placeholder: "Not set yet — click edit to add your values",
      multiline: true,
    },
  } as const;

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border -mt-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeTab === tab.key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Goals tab */}
      {activeTab === "goals" && (
        <div className="space-y-4">
          {goalsError && <p className="text-sm text-destructive">{goalsError.message}</p>}

          {goalsLoading && <PageSkeleton variant="list" />}

          {!goalsLoading && goals && goals.length === 0 && (
            <EmptyState
              icon={Target}
              message="No goals yet"
              description="Goals help you track high-level objectives and align your agents' work toward measurable outcomes."
              action="Create your first goal"
              onAction={() => openNewGoal()}
              entityColor="var(--entity-goal)"
            />
          )}

          {rootGoals.length > 0 && (
            <>
              <div className="flex items-center justify-end">
                <Button size="sm" variant="outline" onClick={() => openNewGoal()}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  New Goal
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {rootGoals.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    subGoalCount={subGoalCounts.get(goal.id) ?? 0}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Vision & Mission tab */}
      {activeTab === "vision" && (
        <div className="max-w-2xl space-y-4">
          <IdentityCard
            label="Vision"
            hint="Where are we headed?"
            value={selectedCompany?.vision ?? ""}
            placeholder="Not set yet — click edit to add your vision"
            onEdit={() => setEditingField("vision")}
          />
          <IdentityCard
            label="Mission"
            hint="How do we get there?"
            value={selectedCompany?.mission ?? ""}
            placeholder="Not set yet — click edit to add your mission"
            onEdit={() => setEditingField("mission")}
          />
          <IdentityCard
            label="Values"
            hint="What do we stand for?"
            value={selectedCompany?.values ?? ""}
            placeholder="Not set yet — click edit to add your values"
            onEdit={() => setEditingField("values")}
          />
        </div>
      )}

      {/* Edit modal */}
      {editingField && (
        <EditIdentityModal
          open
          onOpenChange={(open) => { if (!open) setEditingField(null); }}
          label={fieldConfig[editingField].label}
          hint={fieldConfig[editingField].hint}
          value={
            editingField === "vision"
              ? selectedCompany?.vision ?? ""
              : editingField === "mission"
                ? selectedCompany?.mission ?? ""
                : selectedCompany?.values ?? ""
          }
          onSave={(v) => handleFieldSave(editingField, v)}
          saving={saveMutation.isPending}
          multiline={fieldConfig[editingField].multiline}
        />
      )}
    </div>
  );
}
