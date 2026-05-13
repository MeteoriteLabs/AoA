import { useState } from "react";
import { useCompany } from "@/context/CompanyContext";
import {
  useEnvironments,
  useCreateEnvironment,
  useUpdateEnvironment,
  useDeleteEnvironment,
} from "@/api/environments";
import type { Environment } from "@armyofagents/shared";
import type { CreateEnvironmentInput, UpdateEnvironmentInput } from "@armyofagents/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Layers, Plus, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeStringify(val: Record<string, unknown> | null | undefined): string {
  if (val == null || Object.keys(val).length === 0) return "";
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return "";
  }
}

function safeParse(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
      return { ok: false, error: "Must be a JSON object (e.g. { \"KEY\": \"value\" })" };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

type EnvTargetType = "local" | "sandbox-docker";
type EnvTargetShell = "sh" | "bash";
type EnvTargetNetwork = "bridge" | "host" | "none";

function readTarget(raw: Record<string, unknown> | null | undefined) {
  if (raw?.type !== "sandbox-docker") {
    return {
      targetType: "local" as EnvTargetType,
      targetImage: "",
      targetWorkdir: "/workspace",
      targetShell: "sh" as EnvTargetShell,
      targetNetwork: "bridge" as EnvTargetNetwork,
      targetRemove: true,
      targetInstallCommand: "",
    };
  }
  return {
    targetType: "sandbox-docker" as EnvTargetType,
    targetImage: typeof raw.image === "string" ? raw.image : "",
    targetWorkdir: typeof raw.workdir === "string" ? raw.workdir : "/workspace",
    targetShell: raw.shell === "bash" ? "bash" as EnvTargetShell : "sh" as EnvTargetShell,
    targetNetwork: raw.network === "host" || raw.network === "none" ? raw.network : "bridge" as EnvTargetNetwork,
    targetRemove: raw.remove !== false,
    targetInstallCommand: typeof raw.installCommand === "string" ? raw.installCommand : "",
  };
}

function formatTargetSummary(env: Environment): string {
  if (env.target?.type === "sandbox-docker") {
    const image = typeof env.target.image === "string" && env.target.image.trim()
      ? env.target.image
      : "image missing";
    return `sandbox-docker: ${image}`;
  }
  return "local target";
}

// ---------------------------------------------------------------------------
// Environment form dialog
// ---------------------------------------------------------------------------

interface EnvFormState {
  name: string;
  envVarsRaw: string;
  connectionTargetRaw: string;
  targetType: EnvTargetType;
  targetImage: string;
  targetWorkdir: string;
  targetShell: EnvTargetShell;
  targetNetwork: EnvTargetNetwork;
  targetRemove: boolean;
  targetInstallCommand: string;
}

interface EnvironmentDialogProps {
  open: boolean;
  mode: "create" | "edit";
  initial?: Environment;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (data: CreateEnvironmentInput | UpdateEnvironmentInput) => void;
}

function EnvironmentDialog({
  open,
  mode,
  initial,
  isPending,
  onClose,
  onSubmit,
}: EnvironmentDialogProps) {
  const [form, setForm] = useState<EnvFormState>(() => ({
    name: initial?.name ?? "",
    envVarsRaw: safeStringify(initial?.envVars),
    connectionTargetRaw: safeStringify(initial?.connectionTarget ?? undefined),
    ...readTarget(initial?.target),
  }));

  const [envVarsError, setEnvVarsError] = useState<string | null>(null);
  const [connectionTargetError, setConnectionTargetError] = useState<string | null>(null);

  // Reset form when dialog opens with fresh initial values
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setForm({
        name: initial?.name ?? "",
        envVarsRaw: safeStringify(initial?.envVars),
        connectionTargetRaw: safeStringify(initial?.connectionTarget ?? undefined),
        ...readTarget(initial?.target),
      });
      setEnvVarsError(null);
      setConnectionTargetError(null);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const evResult = safeParse(form.envVarsRaw);
    const ctResult = safeParse(form.connectionTargetRaw);

    if (!evResult.ok) {
      setEnvVarsError(evResult.error);
      return;
    }
    if (!ctResult.ok) {
      setConnectionTargetError(ctResult.error);
      return;
    }
    if (form.targetType === "sandbox-docker" && !form.targetImage.trim()) {
      setConnectionTargetError("Docker image is required for sandbox-docker.");
      return;
    }
    setEnvVarsError(null);
    setConnectionTargetError(null);

    const trimmedCt = form.connectionTargetRaw.trim();
    const target: CreateEnvironmentInput["target"] = form.targetType === "sandbox-docker"
      ? {
          type: "sandbox-docker" as const,
          image: form.targetImage.trim(),
          workdir: form.targetWorkdir.trim() || "/workspace",
          shell: form.targetShell,
          network: form.targetNetwork,
          remove: form.targetRemove,
          ...(form.targetInstallCommand.trim()
            ? { installCommand: form.targetInstallCommand.trim() }
            : {}),
        }
      : { type: "local" as const };
    onSubmit({
      name: form.name.trim(),
      envVars: evResult.value,
      connectionTarget: trimmedCt ? ctResult.value : null,
      target,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "New Environment" : "Edit Environment"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Name <span className="text-destructive">*</span>
            </label>
            <Input
              required
              placeholder="e.g. production"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>

          {/* Env vars */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Environment Variables
            </label>
            <p className="text-xs text-muted-foreground">
              JSON object — keys and values are strings (e.g.{" "}
              <code className="text-[11px] bg-muted/40 px-1 rounded">
                {`{"NODE_ENV": "production"}`}
              </code>
              ).
            </p>
            <Textarea
              rows={5}
              placeholder='{"KEY": "value"}'
              value={form.envVarsRaw}
              onChange={(e) => {
                setForm((f) => ({ ...f, envVarsRaw: e.target.value }));
                setEnvVarsError(null);
              }}
              className={cn("font-mono text-xs", envVarsError && "border-destructive")}
            />
            {envVarsError && (
              <p className="text-xs text-destructive">{envVarsError}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Execution Target
            </label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={form.targetType}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  targetType: e.target.value === "sandbox-docker" ? "sandbox-docker" : "local",
                }))
              }
              data-testid="environment-target-select"
            >
              <option value="local">Local</option>
              <option value="sandbox-docker">Sandbox Docker</option>
            </select>
          </div>

          {form.targetType === "sandbox-docker" && (
            <div className="grid gap-3 rounded-md border border-border p-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Docker Image <span className="text-destructive">*</span>
                </label>
                <Input
                  required
                  placeholder="node:22-bookworm"
                  value={form.targetImage}
                  onChange={(e) => setForm((f) => ({ ...f, targetImage: e.target.value }))}
                  data-testid="environment-target-image-input"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Workdir
                  </label>
                  <Input
                    placeholder="/workspace"
                    value={form.targetWorkdir}
                    onChange={(e) => setForm((f) => ({ ...f, targetWorkdir: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Shell
                  </label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={form.targetShell}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, targetShell: e.target.value === "bash" ? "bash" : "sh" }))
                    }
                  >
                    <option value="sh">sh</option>
                    <option value="bash">bash</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Network
                  </label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={form.targetNetwork}
                    onChange={(e) => {
                      const value = e.target.value;
                      setForm((f) => ({
                        ...f,
                        targetNetwork: value === "host" || value === "none" ? value : "bridge",
                      }));
                    }}
                  >
                    <option value="bridge">bridge</option>
                    <option value="host">host</option>
                    <option value="none">none</option>
                  </select>
                </div>
              </div>
              <Input
                placeholder="Optional install command"
                value={form.targetInstallCommand}
                onChange={(e) => setForm((f) => ({ ...f, targetInstallCommand: e.target.value }))}
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={form.targetRemove}
                  onChange={(e) => setForm((f) => ({ ...f, targetRemove: e.target.checked }))}
                  className="h-4 w-4 rounded border-input"
                />
                Remove container after run
              </label>
            </div>
          )}

          {/* Connection target */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Connection Target <span className="text-muted-foreground/50">(optional)</span>
            </label>
            <p className="text-xs text-muted-foreground">
              JSON object describing the target infrastructure (e.g. host, port, region).
            </p>
            <Textarea
              rows={4}
              placeholder='{"host": "db.example.com", "port": 5432}'
              value={form.connectionTargetRaw}
              onChange={(e) => {
                setForm((f) => ({ ...f, connectionTargetRaw: e.target.value }));
                setConnectionTargetError(null);
              }}
              className={cn("font-mono text-xs", connectionTargetError && "border-destructive")}
            />
            {connectionTargetError && (
              <p className="text-xs text-destructive">{connectionTargetError}</p>
            )}
          </div>

          <DialogFooter className="pt-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="sm" disabled={isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              size="sm"
              disabled={!form.name.trim() || isPending}
            >
              {isPending
                ? mode === "create"
                  ? "Creating…"
                  : "Saving…"
                : mode === "create"
                  ? "Create"
                  : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Row skeleton
// ---------------------------------------------------------------------------

function RowSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-md border border-border px-4 py-3">
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-7 w-14" />
      <Skeleton className="h-7 w-14" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

export function EnvironmentsSection({ companyId }: { companyId: string }) {
  const { data: environments, isLoading, isError } = useEnvironments(companyId);

  const createMutation = useCreateEnvironment();
  const updateMutation = useUpdateEnvironment();
  const deleteMutation = useDeleteEnvironment();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Environment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Environment | null>(null);

  function handleCreate(input: CreateEnvironmentInput | UpdateEnvironmentInput) {
    createMutation.mutate(
      { companyId, input: input as CreateEnvironmentInput },
      { onSuccess: () => setCreateOpen(false) },
    );
  }

  function handleUpdate(input: CreateEnvironmentInput | UpdateEnvironmentInput) {
    if (!editTarget) return;
    updateMutation.mutate(
      { companyId, id: editTarget.id, input: input as UpdateEnvironmentInput },
      { onSuccess: () => setEditTarget(null) },
    );
  }

  function handleDelete() {
    if (!deleteTarget) return;
    deleteMutation.mutate(
      { companyId, id: deleteTarget.id },
      { onSuccess: () => setDeleteTarget(null) },
    );
  }

  const envVarCount = (env: Environment) =>
    Object.keys(env.envVars ?? {}).length;

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Section header                                                      */}
      {/* ------------------------------------------------------------------ */}
      <div className="px-8 pt-6 pb-3 border-b border-border">
        <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/60 font-semibold">
          Settings · Operations
        </div>
        <div className="flex items-center justify-between gap-4 mt-1">
          <div>
            <h2 className="text-[1.4rem] font-bold tracking-tight">
              Environments<span className="text-brand">.</span>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Named sets of environment variables and connection targets injected into agent runs.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="shrink-0"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Environment
          </Button>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Content                                                             */}
      {/* ------------------------------------------------------------------ */}
      <div className="p-8">
        {isLoading ? (
          <div className="space-y-2">
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </div>
        ) : isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            Failed to load environments. Please refresh and try again.
          </div>
        ) : !environments || environments.length === 0 ? (
          /* Empty state */
          <div className="rounded-lg border border-border bg-card py-12 text-center">
            <Layers className="mx-auto h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-foreground">No environments yet</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4 max-w-xs mx-auto">
              Create an environment to inject variables and connection details into agent runs.
            </p>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Create your first environment
            </Button>
          </div>
        ) : (
          /* Environment list */
          <div className="space-y-2">
            {environments.map((env) => (
              <div
                key={env.id}
                className="flex items-center gap-4 rounded-md border border-border px-4 py-3 hover:bg-accent/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{env.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {envVarCount(env) === 0
                      ? "No variables"
                      : `${envVarCount(env)} variable${envVarCount(env) === 1 ? "" : "s"}`}
                    {env.connectionTarget
                      ? " · connection target set"
                      : ""}
                    {" · "}
                    {formatTargetSummary(env)}
                    {" · "}
                    Created {formatDate(env.createdAt)}
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-muted-foreground hover:text-foreground"
                  onClick={() => setEditTarget(env)}
                  title="Edit environment"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span className="sr-only">Edit</span>
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleteTarget(env)}
                  title="Delete environment"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="sr-only">Delete</span>
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Mutation errors */}
        {createMutation.isError && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {createMutation.error instanceof Error
              ? createMutation.error.message
              : "Failed to create environment"}
          </div>
        )}
        {updateMutation.isError && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {updateMutation.error instanceof Error
              ? updateMutation.error.message
              : "Failed to update environment"}
          </div>
        )}
        {deleteMutation.isError && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {deleteMutation.error instanceof Error
              ? deleteMutation.error.message
              : "Failed to delete environment"}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Create dialog                                                       */}
      {/* ------------------------------------------------------------------ */}
      <EnvironmentDialog
        open={createOpen}
        mode="create"
        isPending={createMutation.isPending}
        onClose={() => { setCreateOpen(false); createMutation.reset(); }}
        onSubmit={handleCreate}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Edit dialog                                                         */}
      {/* ------------------------------------------------------------------ */}
      <EnvironmentDialog
        open={!!editTarget}
        mode="edit"
        initial={editTarget ?? undefined}
        isPending={updateMutation.isPending}
        onClose={() => { setEditTarget(null); updateMutation.reset(); }}
        onSubmit={handleUpdate}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Delete confirmation                                                 */}
      {/* ------------------------------------------------------------------ */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete environment?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> will be permanently deleted. Agent runs that
              reference this environment will no longer receive its variables.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Wrapper that reads companyId from context (matches the pattern used by other
// sections — they all either get companyId from props or from CompanyContext).
// ---------------------------------------------------------------------------

export function EnvironmentsSectionWrapper() {
  const { selectedCompanyId } = useCompany();

  if (!selectedCompanyId) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted-foreground">Select a company to manage environments.</p>
      </div>
    );
  }

  return <EnvironmentsSection companyId={selectedCompanyId} />;
}
