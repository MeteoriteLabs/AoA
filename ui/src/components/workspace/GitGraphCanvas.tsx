/**
 * GitGraphCanvas — D3 + Canvas renderer for the Git Command Centre.
 *
 * Uses a trunk-and-arcs layout: main branch is a central horizontal spine;
 * feature branches arc above and below as bezier curves.
 *
 * Exposed via forwardRef as GitGraphCanvasHandle for imperative zoom controls.
 * Animation loop (RAF) only runs when running/in_review tasks are present.
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
  getLayoutBounds,
  computeFitTransform,
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
} from "./git-arc-draw";

/**
 * Max non-trunk branches drawn in the default ("all") Map view. The trunk-and-
 * arcs layout has two lanes (up/down), so beyond ~12 branches the arcs overlap
 * into an unreadable band. Branches beyond the cap are still in the Pipeline tab.
 */
const MAX_DEFAULT_BRANCHES = 12;

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
  trunkY: number,
  threshold = 8,
  railExtentX = 400,
): ArcDefinition | null {
  let best: ArcDefinition | null = null;
  let bestDist = threshold;

  for (const arc of arcs) {
    if (!visibleNames.has(arc.branchName)) continue;
    if (arc.isDone) continue;

    const points: Array<[number, number]> = [];

    if (!arc.isOpen && arc.mergePointX != null) {
      const span = arc.mergePointX - arc.branchPointX;
      const apexX = (arc.branchPointX + arc.mergePointX) / 2;
      const offset = span * 0.25;

      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        if (t <= 0.5) {
          const tt = t * 2;
          const u = 1 - tt;
          points.push([
            u ** 3 * arc.branchPointX + 3 * u ** 2 * tt * (arc.branchPointX + offset) + 3 * u * tt ** 2 * apexX + tt ** 3 * apexX,
            u ** 3 * trunkY + 3 * u ** 2 * tt * trunkY + 3 * u * tt ** 2 * arc.apexY + tt ** 3 * arc.apexY,
          ]);
        } else {
          const tt = (t - 0.5) * 2;
          const u = 1 - tt;
          points.push([
            u ** 3 * apexX + 3 * u ** 2 * tt * apexX + 3 * u * tt ** 2 * (arc.mergePointX! - offset) + tt ** 3 * arc.mergePointX!,
            u ** 3 * arc.apexY + 3 * u ** 2 * tt * arc.apexY + 3 * u * tt ** 2 * trunkY + tt ** 3 * trunkY,
          ]);
        }
      }
    } else {
      const railStartX = arc.branchPointX + 60;
      const curveOffset = railStartX - arc.branchPointX;
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        if (t <= 0.5) {
          const tt = t * 2;
          const u = 1 - tt;
          points.push([
            u ** 3 * arc.branchPointX + 3 * u ** 2 * tt * (arc.branchPointX + curveOffset * 0.4) + 3 * u * tt ** 2 * railStartX + tt ** 3 * railStartX,
            u ** 3 * trunkY + 3 * u ** 2 * tt * trunkY + 3 * u * tt ** 2 * arc.apexY + tt ** 3 * arc.apexY,
          ]);
        } else {
          const railT = (t - 0.5) * 2;
          const railLen = Math.max(200, railExtentX - railStartX);
          points.push([railStartX + railT * railLen, arc.apexY]);
        }
      }
    }

    for (const [px, py] of points) {
      const d = Math.sqrt((cx - px) ** 2 + (cy - py) ** 2);
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

    // Check if any tasks are actively running/in_review (drives RAF loop)
    const hasActiveNodes = useMemo(
      () =>
        branches.some(
          (b) => b.linkedIssueStatus === "in_progress" || b.linkedIssueStatus === "in_review",
        ),
      [branches],
    );

    const layout = useMemo(
      () => computeArcLayout(graph, branches),
      [graph, branches],
    );

    // Always-current layout ref — prevents stale closure in ResizeObserver
    const layoutRef = useRef(layout);
    layoutRef.current = layout;

    // Always-current visible-names ref — used by the fit-to-view bounds so it
    // measures only shown branches (not hundreds of hidden/off-window arcs).
    const visibleNamesRef = useRef(visibleNames);
    visibleNamesRef.current = visibleNames;

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
      drawTrunk(ctx, layout.nodes, layout.trunkY, trunkColor);

      // 2. Arc lines (bezier + rail)
      drawArcLines(ctx, layout.arcs, visibleNames, canvasRightInLayout, layout.trunkY);

      // 3. Flow pulse dots
      if (hasActiveNodes) {
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
    }, [layout, visibleNames, branchByName, taskBranchByTipSha, graph.defaultBranch, graph.branches, hasActiveNodes]);

    // ── RAF loop ────────────────────────────────────────────────────────────

    useEffect(() => {
      if (!hasActiveNodes) return;

      function tick() {
        if (document.visibilityState === "hidden") {
          rafRef.current = null;
          return;
        }
        animPhaseRef.current += 0.05;
        redraw();
        rafRef.current = requestAnimationFrame(tick);
      }

      rafRef.current = requestAnimationFrame(tick);
      return () => {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      };
    }, [hasActiveNodes, redraw]);

    // Static redraw when no animation
    useEffect(() => {
      if (!hasActiveNodes) redraw();
    }, [hasActiveNodes, redraw]);

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
          const bounds = getLayoutBounds(layoutRef.current, visibleNamesRef.current);
          const fit = computeFitTransform(bounds, w, h);
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
