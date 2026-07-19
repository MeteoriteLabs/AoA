import { useEffect, useRef, useState } from "react";
import { FolderOpen, Github } from "lucide-react";
import type { Project } from "@armyofagents/shared";
import { projectsApi } from "../../api/projects";
import { braindumpApi, braindumpIdempotencyKey } from "../../api/braindump";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Reveal } from "../motion";
import { GradientText, StepCard, StepHeading, StepShell } from "../steps/shared";

type BoxStatus = "idle" | "submitting" | "submitted" | "error";

type DumpBox = {
  departmentId: string;
  name: string;
  functionType: string | null;
  /** Connected repo/folder for a software department, shown as a chip.
   *  Null when there's no primary workspace or it's not a software dept. */
  repoChip: string | null;
  content: string;
  status: BoxStatus;
  error: string | null;
};

function repoChipFor(project: Project): string | null {
  if (project.functionType !== "software_development") return null;
  const ws = project.primaryWorkspace ?? project.workspaces[0] ?? null;
  if (!ws) return null;
  return ws.repoUrl || ws.cwd || null;
}

export type BraindumpStepProps = {
  companyId: string;
  onDone: () => void;
};

/**
 * WS6 — the In-flight "Braindump" surface. Standalone, like `DefineDepartments`
 * (WS4) and `IntegrationsStep` (WS5): domain-only, no `advanceOnboarding` call
 * — WS9 sequences Braindump -> Librarian onto Home later.
 *
 * One dump box per department (mockup S7c). A software department that
 * already has a connected repo/local folder (from WS4) pre-shows it as a
 * chip so the founder knows what the Librarian will have context on.
 *
 * Submitting POSTs one braindump per NON-EMPTY box (empty boxes are silently
 * skipped — braindumping is optional per department). Each box tracks its
 * own submit state so one department's failure doesn't block the others,
 * mirroring DefineDepartments' per-department retry pattern. `onDone` fires
 * once every non-empty box has successfully submitted (or there were none);
 * Skip always fires it immediately, regardless of in-progress content.
 */
export function BraindumpStep({ companyId, onDone }: BraindumpStepProps) {
  const [boxes, setBoxes] = useState<DumpBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const doneFiredRef = useRef(false);
  function fireOnDoneOnce() {
    if (doneFiredRef.current) return;
    doneFiredRef.current = true;
    onDone();
  }

  useEffect(() => {
    let cancelled = false;
    projectsApi
      .list(companyId)
      .then((projects) => {
        if (cancelled) return;
        const departments = projects.filter((p) => p.type === "department");
        setBoxes(
          departments.map((d) => ({
            departmentId: d.id,
            name: d.name,
            functionType: d.functionType,
            repoChip: repoChipFor(d),
            content: "",
            status: "idle",
            error: null,
          })),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Couldn't load your departments.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  function updateContent(departmentId: string, content: string) {
    setBoxes((prev) => prev.map((b) => (b.departmentId === departmentId ? { ...b, content } : b)));
  }

  async function submitBox(box: DumpBox): Promise<BoxStatus> {
    try {
      await braindumpApi.submit(companyId, {
        // Phase 5d turns this into a multi-scope surface (a company-wide card
        // plus one per department); today every box is a department.
        scope: "department",
        departmentId: box.departmentId,
        content: box.content.trim(),
        idempotencyKey: braindumpIdempotencyKey(companyId, box.departmentId),
      });
      return "submitted";
    } catch {
      return "error";
    }
  }

  async function submitAll() {
    if (submitting) return;
    setGlobalError(null);
    const toSubmit = boxes.filter((b) => b.content.trim().length > 0 && b.status !== "submitted");
    if (toSubmit.length === 0) {
      fireOnDoneOnce();
      return;
    }
    setSubmitting(true);
    setBoxes((prev) =>
      prev.map((b) => (toSubmit.some((t) => t.departmentId === b.departmentId) ? { ...b, status: "submitting", error: null } : b)),
    );

    const results = await Promise.all(
      toSubmit.map(async (box) => {
        const status = await submitBox(box);
        return { departmentId: box.departmentId, status };
      }),
    );

    setBoxes((prev) =>
      prev.map((b) => {
        const result = results.find((r) => r.departmentId === b.departmentId);
        if (!result) return b;
        return {
          ...b,
          status: result.status,
          error: result.status === "error" ? "Couldn't save this braindump. Try again." : null,
        };
      }),
    );
    setSubmitting(false);

    const allOk = results.every((r) => r.status === "submitted");
    if (allOk) {
      fireOnDoneOnce();
    } else {
      setGlobalError("Some braindumps couldn't be saved — retry or skip below.");
    }
  }

  async function retryBox(departmentId: string) {
    const box = boxes.find((b) => b.departmentId === departmentId);
    if (!box) return;
    setBoxes((prev) => prev.map((b) => (b.departmentId === departmentId ? { ...b, status: "submitting", error: null } : b)));
    const status = await submitBox(box);
    setBoxes((prev) =>
      prev.map((b) =>
        b.departmentId === departmentId
          ? { ...b, status, error: status === "error" ? "Couldn't save this braindump. Try again." : null }
          : b,
      ),
    );
  }

  return (
    <StepShell className="max-w-lg">
      <Reveal>
        <StepHeading
          title={
            <>
              Brain<GradientText>dump</GradientText> what you know
            </>
          }
          subtitle="Paste anything — notes, docs, half-formed thoughts. The Librarian turns it into organized memory."
        />
      </Reveal>

      {loading && <p className="text-center text-sm text-dim">Loading your departments…</p>}
      {loadError && <p className="text-center text-xs text-destructive">{loadError}</p>}

      <div className="flex flex-col gap-3">
        {boxes.map((box, i) => (
          <Reveal key={box.departmentId} delay={0.09 + i * 0.09}>
            <StepCard>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-text">{box.name}</span>
                {box.repoChip && (
                  <span className="flex shrink-0 items-center gap-1 rounded-full border border-border-strong px-2 py-1 text-[10px] text-dim">
                    {box.repoChip.startsWith("http") ? (
                      <Github className="h-3 w-3" aria-hidden />
                    ) : (
                      <FolderOpen className="h-3 w-3" aria-hidden />
                    )}
                    <span className="max-w-[180px] truncate">{box.repoChip}</span>
                  </span>
                )}
              </div>

              <label className="sr-only" htmlFor={`braindump-${box.departmentId}`}>
                Braindump for {box.name}
              </label>
              <Textarea
                id={`braindump-${box.departmentId}`}
                className="mt-3 min-h-[110px]"
                placeholder="Paste notes, context, decisions, anything the team should remember…"
                value={box.content}
                disabled={submitting || box.status === "submitted"}
                onChange={(e) => updateContent(box.departmentId, e.target.value)}
              />

              {box.status === "error" && (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2">
                  <p className="text-xs text-destructive">{box.error}</p>
                  <Button type="button" size="sm" variant="outline" onClick={() => void retryBox(box.departmentId)}>
                    Retry
                  </Button>
                </div>
              )}
              {box.status === "submitted" && (
                <p className="mt-2 text-xs" style={{ color: "var(--done)" }}>
                  Saved
                </p>
              )}
            </StepCard>
          </Reveal>
        ))}
      </div>

      {globalError && <p className="text-xs text-destructive">{globalError}</p>}

      <Reveal delay={0.18 + boxes.length * 0.09}>
        <Button className="w-full" onClick={() => void submitAll()} disabled={submitting || loading}>
          {submitting ? "Saving…" : "Continue"}
        </Button>
      </Reveal>

      <Reveal delay={0.27 + boxes.length * 0.09}>
        <Button type="button" variant="ghost" className="w-full" onClick={fireOnDoneOnce}>
          Skip for now
        </Button>
      </Reveal>
    </StepShell>
  );
}
