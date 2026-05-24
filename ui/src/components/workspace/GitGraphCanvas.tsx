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
  computeStackCardLayout,
  type ArcCommitLayout,
  type ArcDefinition,
  type TipStack,
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
  drawSyncBadge,
  drawTrunk,
  drawArcLines,
  drawArcLabels,
  drawLabelDots,
  drawFlowPulse,
  drawTipStack,
  pointToSegmentDistance,
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
  threshold = 8,
): ArcDefinition | null {
  let best: ArcDefinition | null = null;
  let bestDist = threshold;
  for (const arc of arcs) {
    if (!visibleNames.has(arc.branchName)) continue;
    if (arc.isDone) continue;
    const pts = arc.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = pointToSegmentDistance(cx, cy, pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1]);
      if (d < bestDist) {
        bestDist = d;
        best = arc;
      }
    }
  }
  return best;
}

function hitTestStacks(
  tipStacks: TipStack[],
  branchByName: Map<string, GitBranchInfo>,
  cx: number,
  cy: number,
): GitBranchInfo | null {
  for (const stack of tipStacks) {
    for (const c of computeStackCardLayout(stack)) {
      if (
        cx >= c.x - CARD_W / 2 - 4 &&
        cx <= c.x + CARD_W / 2 + 4 &&
        cy >= c.y - CARD_H / 2 - 4 &&
        cy <= c.y + CARD_H / 2 + 4
      ) {
        const b = branchByName.get(c.branchName);
        if (b) return b;
      }
    }
  }
  return null;
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

    // Trunk x-range (layout space) for trunk-line hover.
    const trunkSpan = useMemo(() => {
      const xs = layout.nodes.filter((n) => n.isTrunk).map((n) => n.x);
      if (xs.length === 0) return null;
      return { minX: Math.min(...xs), maxX: Math.max(...xs) };
    }, [layout]);

    // Stacks restricted to currently-visible branches. A stack needs >=2 visible
    // members to fan; otherwise its node renders the normal single-card path.
    const visibleStacks = useMemo(
      () =>
        layout.tipStacks
          .map((s) => ({ ...s, branchNames: s.branchNames.filter((n) => visibleNames.has(n)) }))
          .filter((s) => s.branchNames.length >= 2),
      [layout.tipStacks, visibleNames],
    );
    // SHAs drawn as a fan (their node becomes a plain dot, not a card).
    const stackedShas = useMemo(
      () => new Set(visibleStacks.map((s) => s.sha)),
      [visibleStacks],
    );
    // Branch names whose (degenerate) arc + label must be suppressed because the
    // branch is shown as a fanned card instead.
    const stackedBranchNames = useMemo(
      () => new Set(visibleStacks.flatMap((s) => s.branchNames)),
      [visibleStacks],
    );
    // visibleNames minus stacked branches — used ONLY for arc lines + arc labels.
    const arcVisibleNames = useMemo(() => {
      const s = new Set(visibleNames);
      for (const n of stackedBranchNames) s.delete(n);
      return s;
    }, [visibleNames, stackedBranchNames]);

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

      // Left viewport edge in layout space (+ a small inset so the stub is visible).
      const viewportLeftInLayout = (0 - t.x) / t.k + 24;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.setTransform(t.k * dpr, 0, 0, t.k * dpr, t.x * dpr, t.y * dpr);

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

      // 2. Arc lines (smooth path through commit nodes + dashed open stub)
      drawArcLines(ctx, layout.arcs, arcVisibleNames, viewportLeftInLayout);

      // 3. Flow pulse dots (trunk pulse always shows; arc pulses self-gate on status)
      {
        const trunkNodes = layout.nodes.filter((n) => n.isTrunk);
        drawFlowPulse(
          ctx,
          layout.arcs,
          trunkNodes,
          branchByName,
          animPhaseRef.current,
          // arcVisibleNames (not visibleNames): a stacked branch's arc line is
          // suppressed, so its flow pulse must be too — otherwise the pulse
          // animates along the hidden degenerate stub ("dot floating in the air").
          arcVisibleNames,
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
        const isStacked = stackedShas.has(node.sha);
        drawCommitNode(ctx, node, animPhaseRef.current, branchStatus, isStacked);

        if (node.isBranchTip && !isStacked) {
          let syncBranch = node.branchName ? branchByName.get(node.branchName) : undefined;
          if (!syncBranch) syncBranch = taskBranchByTipSha.get(node.sha);
          if (syncBranch) drawSyncBadge(ctx, node, syncBranch);
        }

        if (node.isTaskTip && !isStacked) {
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

      // 4b. Same-commit task stacks (fanned cards + connectors + "+N more").
      for (const stack of visibleStacks) {
        drawTipStack(ctx, stack, branchByName, animPhaseRef.current);
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
      drawArcLabels(ctx, layout.arcs, arcVisibleNames, cardBranchNames);

      ctx.restore();
    }, [layout, visibleNames, arcVisibleNames, visibleStacks, stackedShas, branchByName, taskBranchByTipSha, graph.defaultBranch, graph.branches]);

    // ── RAF loop (throttled to ~30fps, pauses when the tab is hidden) ─────────

    // Single source of truth for the animation tick — used by both the mount
    // effect and the visibilitychange resume handler (no duplicated tick).
    const startRafLoop = useCallback(() => {
      if (rafRef.current !== null) return; // already running
      const tick = () => {
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
      };
      rafRef.current = requestAnimationFrame(tick);
    }, [redraw]);

    // Run the loop on mount / whenever redraw changes.
    useEffect(() => {
      startRafLoop();
      return () => {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      };
    }, [startRafLoop]);

    // Resume the loop when the tab becomes visible again.
    useEffect(() => {
      const onVis = () => {
        if (document.visibilityState === "visible") startRafLoop();
      };
      document.addEventListener("visibilitychange", onVis);
      return () => document.removeEventListener("visibilitychange", onVis);
    }, [startRafLoop]);

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

        // Fanned same-commit stack cards take priority over the underlying node.
        const stackBranch = hitTestStacks(visibleStacks, branchByName, cx, cy);
        if (stackBranch) {
          canvas.style.cursor = "pointer";
          onHover(
            stackBranch.linkedIssueId
              ? { type: "task", branch: stackBranch }
              : { type: "plain_tip", branch: stackBranch },
            { x: e.clientX, y: e.clientY },
          );
          return;
        }

        const hit = hitTest(layout.nodes, cx, cy);

        if (!hit) {
          // No node — check if cursor is over a branch arc
          const arcHit = hitTestArc(layout.arcs, visibleNames, cx, cy);
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
            return;
          }

          // No arc — check the trunk line (horizontal at layout.trunkY).
          if (
            trunkSpan &&
            Math.abs(cy - layout.trunkY) <= 8 &&
            cx >= trunkSpan.minX - 8 &&
            cx <= trunkSpan.maxX + 8
          ) {
            let nearest: ArcCommitLayout | null = null;
            let nd = Infinity;
            for (const n of layout.nodes) {
              if (!n.isTrunk) continue;
              const d = Math.abs(n.x - cx);
              if (d < nd) { nd = d; nearest = n; }
            }
            if (nearest) {
              const commit = graph.commits.find((c) => c.sha === nearest!.sha);
              if (commit) {
                canvas.style.cursor = "pointer";
                onHover({ type: "commit", commit }, { x: e.clientX, y: e.clientY });
                return;
              }
            }
          }

          canvas.style.cursor = "grab";
          onHover(null, { x: e.clientX, y: e.clientY });
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
      [layout.nodes, layout.arcs, layout.trunkY, trunkSpan, visibleNames, visibleStacks, branchByName, taskBranchByTipSha, graph.commits, onHover],
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

        const stackBranch = hitTestStacks(visibleStacks, branchByName, cx, cy);
        if (stackBranch?.linkedIssueId) {
          onClick({ type: "task", branch: stackBranch });
          return;
        }

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
      [layout.nodes, visibleStacks, branchByName, taskBranchByTipSha, graph.commits, onClick],
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
