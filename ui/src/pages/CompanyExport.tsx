import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Download, FileDown, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import type {
  CompanyPortabilityExportPreviewResult,
  CompanyPortabilityExportResult,
  CompanyPortabilityInclude,
} from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { companyPortabilityApi } from "../api/company-portability";
import { ApiError } from "../api/client";

type IncludeFlags = {
  company: boolean;
  agents: boolean;
  projects: boolean;
  issues: boolean;
  skills: boolean;
  routines: boolean;
  envInputs: boolean;
};

const DEFAULT_FLAGS: IncludeFlags = {
  company: true,
  agents: true,
  projects: false,
  issues: false,
  skills: false,
  routines: false,
  envInputs: false,
};

type EntityRow = {
  key: Exclude<keyof IncludeFlags, "company">;
  label: string;
  description: string;
};

const ENTITY_ROWS: EntityRow[] = [
  { key: "agents", label: "Agents", description: "Agent configs, adapter types, roles, and reporting structure." },
  { key: "projects", label: "Projects", description: "Departments and projects including parent hierarchy." },
  { key: "issues", label: "Tasks", description: "All tasks with status, priority, assignees, and labels." },
  { key: "skills", label: "Skills", description: "Company-scoped skills with source tracking and file inventory." },
  { key: "routines", label: "Routines", description: "Routines with triggers (schedule/webhook/api) and variables." },
  { key: "envInputs", label: "Environment Inputs", description: "Agent env bindings with secret/plain classification." },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Unexpected error";
}

export type CompanyExportProps = {
  initialPreview?: CompanyPortabilityExportPreviewResult | null;
  showcase?: boolean;
};

export function CompanyExport({ initialPreview = null, showcase = false }: CompanyExportProps = {}) {
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [flags, setFlags] = useState<IncludeFlags>(DEFAULT_FLAGS);
  const [preview, setPreview] = useState<CompanyPortabilityExportPreviewResult | null>(initialPreview);

  useEffect(() => {
    setBreadcrumbs([{ label: "Export Company" }]);
  }, [setBreadcrumbs]);

  const previewMutation = useMutation({
    mutationFn: (include: CompanyPortabilityInclude) => {
      if (!selectedCompanyId) throw new Error("No company selected");
      return companyPortabilityApi.previewExport(selectedCompanyId, include);
    },
    onSuccess: (data) => setPreview(data),
  });

  const downloadMutation = useMutation({
    mutationFn: (include: CompanyPortabilityInclude) => {
      if (!selectedCompanyId) throw new Error("No company selected");
      return companyPortabilityApi.exportBundle(selectedCompanyId, include);
    },
    onSuccess: (bundle) => downloadBundle(bundle, selectedCompany?.issuePrefix ?? "company"),
  });

  function toggleFlag(key: EntityRow["key"]) {
    setFlags((prev) => ({ ...prev, [key]: !prev[key] }));
    setPreview(null);
  }

  function handlePreview() {
    if (showcase) return;
    previewMutation.mutate(flags);
  }

  function handleDownload() {
    if (showcase) return;
    downloadMutation.mutate(flags);
  }

  const canDownload = !!preview && !!selectedCompanyId && !downloadMutation.isPending;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <FileDown className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-bold">Export Company</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {selectedCompany ? (
            <>
              Package{" "}
              <span className="font-medium text-foreground">{selectedCompany.name}</span>{" "}
              into a portable bundle. Run a preview to see what will be included, then download.
            </>
          ) : (
            <>Select a company to export.</>
          )}
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-6">
          <div>
            <h2 className="text-sm font-semibold">What to include</h2>
            <p className="text-xs text-muted-foreground">
              Company metadata is always included. Toggle additional entities below.
            </p>
          </div>
          <Separator />

          <div className="space-y-3">
            <label className="flex items-start gap-3">
              <Checkbox
                id="include-company"
                aria-label="Company"
                checked
                disabled
              />
              <div className="-mt-[2px]">
                <Label htmlFor="include-company" className="font-medium">
                  Company
                </Label>
                <p className="text-xs text-muted-foreground">
                  Name, description, brand color. Always included.
                </p>
              </div>
            </label>

            {ENTITY_ROWS.map((row) => (
              <label key={row.key} className="flex items-start gap-3">
                <Checkbox
                  id={`include-${row.key}`}
                  aria-label={row.label}
                  checked={flags[row.key]}
                  onCheckedChange={() => toggleFlag(row.key)}
                />
                <div className="-mt-[2px]">
                  <Label htmlFor={`include-${row.key}`} className="font-medium">
                    {row.label}
                  </Label>
                  <p className="text-xs text-muted-foreground">{row.description}</p>
                </div>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button
          onClick={handlePreview}
          disabled={!selectedCompanyId || previewMutation.isPending}
        >
          {previewMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Previewing...
            </>
          ) : (
            <>Preview</>
          )}
        </Button>
        <Button variant="outline" onClick={handleDownload} disabled={!canDownload}>
          {downloadMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Downloading...
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              Download
            </>
          )}
        </Button>
      </div>

      {previewMutation.isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {errorMessage(previewMutation.error)}
        </div>
      )}
      {downloadMutation.isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {errorMessage(downloadMutation.error)}
        </div>
      )}

      {preview && <PreviewSummary preview={preview} />}
    </div>
  );
}

function PreviewSummary({ preview }: { preview: CompanyPortabilityExportPreviewResult }) {
  const countRows: Array<{ label: string; value: number }> = [
    { label: "Agents", value: preview.counts.agents },
    { label: "Projects", value: preview.counts.projects },
    { label: "Tasks", value: preview.counts.issues },
    { label: "Skills", value: preview.counts.skills },
    { label: "Routines", value: preview.counts.routines },
    { label: "Env inputs", value: preview.counts.envInputs },
  ];
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <h2 className="text-sm font-semibold">Preview</h2>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {countRows.map((row) => (
            <div key={row.label} className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">{row.label}</p>
              <p className="text-lg font-semibold">{row.value}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{preview.files.length} files</span>
          <span>~{formatBytes(preview.estimatedBytes)}</span>
        </div>
        {preview.warnings.length > 0 && (
          <div className="rounded-md border border-amber-400/50 bg-amber-50 p-3 dark:bg-amber-950/20">
            <div className="mb-1 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                Warnings ({preview.warnings.length})
              </p>
            </div>
            <ul className="list-disc space-y-1 pl-6 text-xs text-amber-800 dark:text-amber-200">
              {preview.warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function downloadBundle(bundle: CompanyPortabilityExportResult, prefix: string) {
  const payload = JSON.stringify(bundle, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  anchor.download = `${prefix.toLowerCase()}-${stamp}.aoa-bundle.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
