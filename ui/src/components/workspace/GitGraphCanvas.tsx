/**
 * GitGraphCanvas — D3 + Canvas renderer for the Git Command Centre.
 *
 * Uses a trunk-and-arcs layout: main branch is a central horizontal spine;
 * feature branches arc above and below as bezier curves.
 *
 * Exposed via forwardRef as GitGraphCanvasHandle for imperative zoom controls.
 * Animation loop (RAF) runs always while the tab is visible, throttled to ~30fps,
 * so the trunk's left→right pulse animates continuously.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import * as d3 from "d3";
import type { GitBranchInfo, GitGraphData } from "@armyofagents/shared";
import type { HoveredNode } from "./GitHoverCard";
import {
  computeArcLayout,
  computeHeadFocusTransform,
  type ArcCommitLayout,
  type ArcDefinition,
} from "./git-arc-layout";
import {
  COMMIT_R,
  CARD_W,
  CARD_H,
  drawCommitNode,
  drawCardLabel,
  drawCardBadges,
  drawTagPills,
  drawHeadLabel,
  drawTrunk,
  drawArcLines,
  drawArcLabels,
  drawLabelDots,
  drawFlowPulse,
  polylinePointAt,
} from "./git-arc-draw";

/**
 * Max non-trunk branches drawn in the default ("all") Map view. The trunk-and-
 * arcs layout has two lanes (up/down), so beyond ~12 branches the arcs overlap
 * into an unreadable band. Branches beyond the cap are still in the Pipeline tab.
 */
export const MAX_DEFAULT_BRANCHES = 12;

// ---------------------------------------------------------------------------
// Public handle (for toolbar zoom controls)
// ---------------------------------------------------------------------------

export interface GitGraphCanvasHandle {
  zoomIn(): void;
  zoomOut(): void;
  resetZoom(): void;
}


export interface GitGraphCanvasProps {
  branches: GitBranchInfo[];
  graph: GitGraphData;
  filter: "all" | "running" | "blocked" | "prs" | "merged";
  onHover: (node: HoveredNode | null, position: { x: number; y: number }) => void;
  onClick: (node: HoveredNode) => void;
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

function hitTest(
  nodes: ArcCommitLayout[],
  cx: number,
  cy: number,
): ArcCommitLayout | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!;
    if (n.isTaskTip) {
      if (
        cx >= n.x - CARD_W / 2 - 4 &&
        cx <= n.x + CARD_W / 2 + 4 &&
        cy >= n.y - CARD_H / 2 - 4 &&
        cy <= n.y + CARD_H / 2 + 4
      ) {
        return n;
      }
    } else {
      const dist = Math.sqrt((cx - n.x) ** 2 + (cy - n.y) ** 2);
      if (dist <= COMMIT_R + 4) return n;
    }
  }
  return null;
}

function hitTestArc(
  arcs: ArcDefinition[],
  visibleNames: Set<string>,
  cx: number,
  cy: number,
  _trunkY: number,
  threshold = 8,
  _railExtentX = 400,
): ArcDefinition | null {
  let best: ArcDefinition | null = null;
  let bestDist = threshold;
  for (const arc of arcs) {
    if (!visibleNames.has(arc.branchName)) continue;
    if (arc.isDone) continue;
    for (let i = 0; i <= 24; i++) {
      const [px, py] = polylinePointAt(arc.points, i / 24);
      const d = Math.hypot(cx - px, cy - py);
      if (d < bestDist) {
        bestDist = d;
        best = arc;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const GitGraphCanvas = forwardRef<GitGraphCanvasHandle, GitGraphCanvasProps>(
  function GitGraphCanvas({ branches, graph, filter, onHover, onClick }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const transformRef = useRef(d3.zoomIdentity);
    const zoomRef = useRef<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
    const initialPanApplied = useRef(false);
    const rafRef = useRef<number | null>(null);
    const animPhaseRef = useRef(0);
    const frameSkipRef = useRef(0);

    const branchByName = useMemo(
      () => new Map(branches.map((b) => [b.name, b])),
      [branches],
    );

    // Map tipSha → task branch (for collision fix when branches share a tip SHA)
    const taskBranchByTipSha = useMemo(() => {
      const m = new Map<string, GitBranchInfo>();
      for (const b of branches) {
        if (b.lastCommitSha && b.linkedIssueId && !m.has(b.lastCommitSha)) {
          m.set(b.lastCommitSha, b);
        }
      }
      return m;
    }, [branches]);

    // Filter branches.
    // Default ("all") = the trunk + every branch that is NOT done/cancelled
    // (both AoA task branches AND plain git branches), capped at the N most
    // recently-committed so the Map stays readable. Done/cancelled show via the
    // "Merged" chip; the full list lives in the Pipeline tab. The cap matters
    // for real repos (e.g. SeaMaster has ~80 branches, paperclip ~296) where
    // showing every branch at once is an unreadable smear.
    const visibleBranches = useMemo(() => {
      if (filter === "running") return branches.filter((b) => b.linkedIssueStatus === "in_progress");
      if (filter === "blocked") return branches.filter((b) => b.linkedIssueStatus === "blocked");
      if (filter === "prs")     return branches.filter((b) => !!b.pr);
      if (filter === "merged")  return branches.filter(
        (b) => b.linkedIssueStatus === "done" || b.linkedIssueStatus === "cancelled",
      );
      // default "all"
      const isDone = (b: GitBranchInfo) =>
        b.linkedIssueStatus === "done" || b.linkedIssueStatus === "cancelled";
      const trunk = branches.filter((b) => b.name === graph.defaultBranch);
      const rest = branches
        .filter((b) => b.name !== graph.defaultBranch && !isDone(b))
        .sort((a, b) => (b.lastCommitAt ?? "").localeCompare(a.lastCommitAt ?? ""))
        .slice(0, MAX_DEFAULT_BRANCHES);
      return [...trunk, ...rest];
    }, [branches, filter, graph.defaultBranch]);

    const visibleNames = useMemo(() => {
      const names = new Set(visibleBranches.map((b) => b.name));
      names.add(graph.defaultBranch); // trunk always visible
      return names;
    }, [visibleBranches, graph.defaultBranch]);

    const layout = useMemo(
      () => computeArcLayout(graph, branches),
      [graph, branches],
    );

    // Always-current layout ref — prevents stale closure in ResizeObserver
    const layoutRef = useRef(layout);
    layoutRef.current = layout;

    // Reset initial-pan flag whenever graph data changes
    useEffect(() => {
      initialPanApplied.current = false;
    }, [graph]);

    // ── Imperative zoom handle ──────────────────────────────────────────────

    useImperativeHandle(ref, () => ({
      zoomIn() {
        const canvas = canvasRef.current;
        if (!canvas || !zoomRef.current) return;
        d3.select(canvas).call(zoomRef.current.scaleBy, 1.4);
      },
      zoomOut() {
        const canvas = canvasRef.current;
        if (!canvas || !zoomRef.current) return;
        d3.select(canvas).call(zoomRef.current.scaleBy, 1 / 1.4);
      },
      resetZoom() {
        const canvas = canvasRef.current;
        if (!canvas || !zoomRef.current) return;
        d3.select(canvas).call(zoomRef.current.transform, d3.zoomIdentity);
      },
    }));

    // ── Redraw ──────────────────────────────────────────────────────────────

    const redraw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const t = transformRef.current;
      const dpr = window.devicePixelRatio || 1;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.setTransform(t.k * dpr, 0, 0, t.k * dpr, t.x * dpr, t.y * dpr);

      // Canvas right edge in layout space (for open-arc rail endpoint)
      const canvasRightInLayout = (canvas.width / dpr - t.x) / t.k;

      // Default branch color for trunk line
      const trunkColor =
        graph.branches.find((b) => b.name === graph.defaultBranch)?.color ?? "#6470DC";

      // Filter nodes: trunk always shown; arc nodes filtered by arcBranchName
      const visibleNodes = layout.nodes.filter((n) => {
        if (n.isTrunk) return visibleNames.has(graph.defaultBranch);
        return n.arcBranchName != null && visibleNames.has(n.arcBranchName);
      });

      // 1. Trunk line
      drawTrunk(ctx, layout.nodes, layout.trunkY, trunkColor, graph.defaultBranch);

      // 2. Arc lines (bezier + rail)
      drawArcLines(ctx, layout.arcs, visibleNames, canvasRightInLayout, layout.trunkY);

      // 3. Flow pulse dots (trunk pulse always shows; arc pulses self-gate on status)
      {
        const trunkNodes = layout.nodes.filter((n) => n.isTrunk);
        drawFlowPulse(
          ctx,
          layout.arcs,
          trunkNodes,
          branchByName,
          animPhaseRef.current,
          visibleNames,
          layout.trunkY,
          graph.defaultBranch,
        );
      }

      // 4. Commit nodes + task labels + badges + label dots.
      // Track which branches render a card so arc labels can skip them (the
      // card already shows the identifier + title — drawing both collides).
      const cardBranchNames = new Set<string>();
      for (const node of visibleNodes) {
        const branchStatus =
          node.branchName != null
            ? (branchByName.get(node.branchName)?.linkedIssueStatus ?? null)
            : null;
        drawCommitNode(ctx, node, animPhaseRef.current, branchStatus);

        if (node.isTaskTip) {
          let branch = node.branchName ? branchByName.get(node.branchName) : undefined;
          if (!branch?.linkedIssueId) branch = taskBranchByTipSha.get(node.sha);
          if (branch?.linkedIssueId) {
            drawCardLabel(ctx, node, branch);
            drawCardBadges(ctx, node, branch);
            drawLabelDots(ctx, node, branch);
            if (node.arcBranchName) cardBranchNames.add(node.arcBranchName);
          }
        }
      }

      // 5. Tag pills
      for (const node of visibleNodes) {
        if (node.tags.length > 0) drawTagPills(ctx, node);
      }

      // 6. HEAD label on default branch tip
      const defaultTip = visibleNodes.find((n) => n.isDefault && n.branchName != null);
      if (defaultTip) drawHeadLabel(ctx, defaultTip);

      // 7. Arc labels (branch name near apex) — only for plain branches that
      // don't already have a task card.
      drawArcLabels(ctx, layout.arcs, visibleNames, cardBranchNames);

      ctx.restore();
    }, [layout, visibleNames, branchByName, taskBranchByTipSha, graph.defaultBranch, graph.branches]);

    // ── RAF loop ────────────────────────────────────────────────────────────

    useEffect(() => {
      function tick() {
        if (document.visibilityState === "hidden") {
          rafRef.current = null;
          return;
        }
        // Throttle to ~30fps: advance + redraw on every other frame.
        frameSkipRef.current = (frameSkipRef.current + 1) % 2;
        if (frameSkipRef.current === 0) {
          animPhaseRef.current += 0.1; // larger step compensates for ~30fps
          redraw();
        }
        rafRef.current = requestAnimationFrame(tick);
      }
      rafRef.current = requestAnimationFrame(tick);
      return () => {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      };
    }, [redraw]);

    // Resume animation when the tab becomes visible again.
    useEffect(() => {
      const onVis = () => {
        if (document.visibilityState === "visible" && rafRef.current === null) {
          rafRef.current = requestAnimationFrame(function tick() {
            if (document.visibilityState === "hidden") { rafRef.current = null; return; }
            frameSkipRef.current = (frameSkipRef.current + 1) % 2;
            if (frameSkipRef.current === 0) {
              animPhaseRef.current += 0.1;
              redraw();
            }
            rafRef.current = requestAnimationFrame(tick);
          });
        }
      };
      document.addEventListener("visibilitychange", onVis);
      return () => document.removeEventListener("visibilitychange", onVis);
    }, [redraw]);

    // ── Resize handler ──────────────────────────────────────────────────────

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const parent = canvas.parentElement;
      if (!parent) return;

      const obs = new ResizeObserver(() => {
        const dpr = window.devicePixelRatio || 1;
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;

        // Initial fit-to-view: scale to fit vertically (arcs stay readable) and
        // center / right-align horizontally so the trunk AND branch arcs are
        // visible. Replaces the old pin-to-right pan that pushed arcs off-screen.
        if (!initialPanApplied.current && zoomRef.current && w > 0 && h > 0) {
          const fit = computeHeadFocusTransform(
            layoutRef.current,
            graph.defaultBranch,
            w,
            h,
          );
          const t = d3.zoomIdentity.translate(fit.x, fit.y).scale(fit.k);
          d3.select(canvas).call(zoomRef.current.transform, t);
          initialPanApplied.current = true;
        }

        redraw();
      });
      obs.observe(parent);
      return () => obs.disconnect();
    }, [redraw]);

    // ── D3 zoom ─────────────────────────────────────────────────────────────

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const zoom = d3
        .zoom<HTMLCanvasElement, unknown>()
        .scaleExtent([0.2, 4])
        .on("start", () => {
          canvas.style.cursor = "grabbing";
        })
        .on("zoom", (event: d3.D3ZoomEvent<HTMLCanvasElement, unknown>) => {
          transformRef.current = event.transform;
          redraw();
        })
        .on("end", () => {
          canvas.style.cursor = "grab";
        });

      zoomRef.current = zoom;
      d3.select(canvas).call(zoom);
      return () => {
        d3.select(canvas).on(".zoom", null);
        zoomRef.current = null;
      };
    }, [redraw]);

    // ── Pointer events ──────────────────────────────────────────────────────

    const handleMouseMove = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const t = transformRef.current;
        const cx = (e.clientX - rect.left - t.x) / t.k;
        const cy = (e.clientY - rect.top - t.y) / t.k;
        const dpr = window.devicePixelRatio || 1;
        const canvasRightInLayout = (canvas.width / dpr - t.x) / t.k;

        const hit = hitTest(layout.nodes, cx, cy);

        if (!hit) {
          // No node — check if cursor is over a branch arc
          const arcHit = hitTestArc(layout.arcs, visibleNames, cx, cy, layout.trunkY, 8, canvasRightInLayout);
          if (arcHit) {
            canvas.style.cursor = "pointer";
            const branch = branchByName.get(arcHit.branchName);
            if (branch) {
              onHover(
                branch.linkedIssueId
                  ? { type: "task", branch }
                  : { type: "plain_tip", branch },
                { x: e.clientX, y: e.clientY },
              );
            } else {
              onHover(null, { x: e.clientX, y: e.clientY });
            }
          } else {
            canvas.style.cursor = "grab";
            onHover(null, { x: e.clientX, y: e.clientY });
          }
          return;
        }

        // Node hit — update cursor
        canvas.style.cursor = "pointer";

        // 1. Task tip — handle SHA collision (main + feature branch at same commit)
        if (hit.isTaskTip) {
          let branch = hit.branchName ? branchByName.get(hit.branchName) : undefined;
          if (!branch?.linkedIssueId) {
            // tipShaToLane assigned this SHA to a non-task branch first (e.g. main).
            // Fall back to the task branch that actually owns this tip SHA.
            branch = taskBranchByTipSha.get(hit.sha);
          }
          if (branch?.linkedIssueId) {
            onHover({ type: "task", branch }, { x: e.clientX, y: e.clientY });
            return;
          }
          // SHA flagged as task tip but we couldn't resolve the branch — fall through
        }

        // 2. Non-task branch tip → plain_tip
        if (hit.branchName) {
          const branch = branchByName.get(hit.branchName);
          if (branch) {
            onHover({ type: "plain_tip", branch }, { x: e.clientX, y: e.clientY });
            return;
          }
        }

        // 3. Merge commit
        if (hit.isMerge) {
          const commit = graph.commits.find((c) => c.sha === hit.sha);
          if (commit) {
            onHover({ type: "merge", commit }, { x: e.clientX, y: e.clientY });
            return;
          }
        }

        // 4. Regular commit
        const commit = graph.commits.find((c) => c.sha === hit.sha);
        if (commit) {
          onHover({ type: "commit", commit }, { x: e.clientX, y: e.clientY });
        }
      },
      [layout.nodes, layout.arcs, visibleNames, branchByName, taskBranchByTipSha, graph.commits, onHover],
    );

    const handleMouseLeave = useCallback(() => {
      const canvas = canvasRef.current;
      if (canvas) canvas.style.cursor = "grab";
      // Don't null immediately — GitCommandCentre uses a 200ms grace period timer
      onHover(null, { x: 0, y: 0 });
    }, [onHover]);

    const handleClick = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const t = transformRef.current;
        const cx = (e.clientX - rect.left - t.x) / t.k;
        const cy = (e.clientY - rect.top - t.y) / t.k;

        const hit = hitTest(layout.nodes, cx, cy);
        if (!hit) return;

        if (hit.isTaskTip) {
          let branch = hit.branchName ? branchByName.get(hit.branchName) : undefined;
          if (!branch?.linkedIssueId) {
            branch = taskBranchByTipSha.get(hit.sha);
          }
          if (branch?.linkedIssueId) {
            onClick({ type: "task", branch });
            return;
          }
        }

        if (hit.branchName) {
          const branch = branchByName.get(hit.branchName);
          if (branch) {
            onClick({ type: "plain_tip", branch });
            return;
          }
        }

        if (hit.isMerge) {
          const commit = graph.commits.find((c) => c.sha === hit.sha);
          if (commit) { onClick({ type: "merge", commit }); return; }
        }

        const commit = graph.commits.find((c) => c.sha === hit.sha);
        if (commit) onClick({ type: "commit", commit });
      },
      [layout.nodes, branchByName, taskBranchByTipSha, graph.commits, onClick],
    );

    return (
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-grab"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      />
    );
  },
);
