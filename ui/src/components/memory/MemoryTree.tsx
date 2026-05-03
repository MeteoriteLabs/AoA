import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { ChevronLeft } from "lucide-react";
import type {
  MemoryFolderRecord,
  MemoryItem,
  Project,
  Goal,
} from "@armyofagents/shared";
import { memoryFoldersApi } from "../../api/memoryFolders";
import { memoryApi } from "../../api/memory";
import { projectsApi } from "../../api/projects";
import { goalsApi } from "../../api/goals";
import { queryKeys } from "../../lib/queryKeys";
import { useCompany } from "../../context/CompanyContext";
import { FolderTreeNode } from "./FolderTreeNode";
import { Skeleton } from "@/components/ui/skeleton";

interface MemoryTreeProps {
  companyId: string;
  selectedFolderPath: string;
  selectedDepartmentId: string | null;
}

interface TreeNode {
  key: string;
  label: string;
  icon?: string;
  count?: number;
  depth: number;
  hasChildren: boolean;
  /** When set, click navigates here. When null, clicking only toggles expand. */
  target: { folder: string; dept: string | null; layer?: string; goal?: string } | null;
  children?: TreeNode[];
}

const LAYER_KEYS = ["identity", "domain", "active_context", "working"] as const;
type LayerKey = (typeof LAYER_KEYS)[number];

const LAYER_META: Record<LayerKey, { label: string; icon: string }> = {
  identity: { label: "Identity", icon: "🪪" },
  domain: { label: "Domain", icon: "🏢" },
  active_context: { label: "Active Context", icon: "🎯" },
  working: { label: "Working", icon: "⚡" },
};

const DEFAULT_EXPANDED = new Set<string>([
  "__layer-identity",
  "__layer-domain",
]);

export function MemoryTree({
  companyId,
  selectedFolderPath,
  selectedDepartmentId,
}: MemoryTreeProps) {
  const navigate = useNavigate();
  const { selectedCompany } = useCompany();
  const companyPrefix = selectedCompany?.issuePrefix ?? "";

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(DEFAULT_EXPANDED),
  );

  const { data: folders, isLoading: foldersLoading } = useQuery({
    queryKey: queryKeys.memory.folders.list(companyId),
    queryFn: () => memoryFoldersApi.list(companyId),
  });

  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: queryKeys.projects.list(companyId),
    queryFn: () => projectsApi.list(companyId),
  });

  const { data: items } = useQuery({
    queryKey: queryKeys.memory.list(companyId),
    queryFn: () => memoryApi.list(companyId, {}),
    enabled: Boolean(companyId),
  });

  const { data: goals } = useQuery({
    queryKey: queryKeys.goals.list(companyId),
    queryFn: () => goalsApi.list(companyId),
    enabled: Boolean(companyId),
  });

  const departments = useMemo<Project[]>(
    () =>
      (projects ?? []).filter(
        (p: Project) => p.type === "department" && !p.archivedAt,
      ),
    [projects],
  );

  const counts = useMemo(() => {
    const all = (items ?? []) as Array<
      MemoryItem & {
        founderPinnedToTop?: boolean;
        layer?: LayerKey | null;
        departmentId?: string | null;
        goalId?: string | null;
      }
    >;
    const byLayer: Record<LayerKey, number> = {
      identity: 0,
      domain: 0,
      active_context: 0,
      working: 0,
    };
    const byDeptDomain = new Map<string, number>();
    const byGoalActive = new Map<string, number>();
    let pinned = 0;
    let pending = 0;
    let recent = 0;
    let archived = 0;
    const recentCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    for (const it of all) {
      if (it.layer && it.layer in byLayer) byLayer[it.layer] += 1;
      if (it.layer === "domain" && it.departmentId) {
        byDeptDomain.set(it.departmentId, (byDeptDomain.get(it.departmentId) ?? 0) + 1);
      }
      if (it.layer === "active_context" && it.goalId) {
        byGoalActive.set(it.goalId, (byGoalActive.get(it.goalId) ?? 0) + 1);
      }
      if (it.founderPinnedToTop) pinned += 1;
      if (it.status === "pending") pending += 1;
      if (it.status === "archived") archived += 1;
      const updatedAtMs = new Date(
        typeof it.updatedAt === "string" ? it.updatedAt : it.updatedAt,
      ).getTime();
      if (Number.isFinite(updatedAtMs) && updatedAtMs >= recentCutoff && it.status !== "archived") {
        recent += 1;
      }
    }
    return { byLayer, byDeptDomain, byGoalActive, pinned, pending, recent, archived };
  }, [items]);

  const activeGoals = useMemo<Goal[]>(
    () => (goals ?? []).filter((g) => g.status === "active"),
    [goals],
  );

  const tree = useMemo(
    () =>
      buildTree({
        folders: folders ?? [],
        departments,
        activeGoals,
        counts,
      }),
    [folders, departments, activeGoals, counts],
  );

  // Auto-expand the ancestor chain of the selected scope.
  useEffect(() => {
    if (!selectedFolderPath && !selectedDepartmentId) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      // Domain dept selection -> expand Domain layer.
      if (selectedDepartmentId) {
        next.add("__layer-domain");
        next.add(`dept-${selectedDepartmentId}`);
      }
      // Active goal selection -> expand Active Context layer + that goal.
      // Goal selection shape: folder = "__goal-<goalId>".
      if (selectedFolderPath.startsWith("__goal-")) {
        next.add("__layer-active_context");
        next.add(selectedFolderPath);
      }
      // Layer selection -> expand that layer.
      if (selectedFolderPath.startsWith("__layer-")) {
        next.add(selectedFolderPath);
      }
      return next;
    });
  }, [selectedFolderPath, selectedDepartmentId]);

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectNode(node: TreeNode) {
    if (!node.target) {
      // No navigation; just toggle expansion (used for layer headers, etc.)
      toggleExpand(node.key);
      return;
    }
    // For nodes with children (layer headers), also toggle expansion on click.
    if (node.hasChildren) {
      toggleExpand(node.key);
    }
    const t = node.target;
    const params = new URLSearchParams();
    if (t.layer) params.set("layer", t.layer);
    if (t.folder) params.set("folder", t.folder);
    if (t.dept) params.set("dept", t.dept);
    if (t.goal) params.set("goal", t.goal);
    const search = params.toString();
    navigate(
      search
        ? `/${companyPrefix}/memory/explore?${search}`
        : `/${companyPrefix}/memory/explore`,
    );
  }

  function isSelected(target: TreeNode["target"]): boolean {
    if (!target) return false;
    return (
      target.folder === selectedFolderPath &&
      (target.dept ?? null) === (selectedDepartmentId ?? null)
    );
  }

  function renderNode(node: TreeNode): ReactNode {
    const isExpanded = expanded.has(node.key);
    return (
      <div key={node.key}>
        <FolderTreeNode
          label={node.label}
          icon={node.icon}
          count={node.count}
          depth={node.depth}
          expanded={isExpanded}
          selected={isSelected(node.target)}
          hasChildren={node.hasChildren}
          onToggleExpand={() => toggleExpand(node.key)}
          onSelect={() => selectNode(node)}
        />
        {isExpanded &&
          node.children &&
          node.children.map((child) => renderNode(child))}
      </div>
    );
  }

  const isLoading = foldersLoading || projectsLoading;

  return (
    <div className="h-full flex flex-col bg-card/50">
      <div className="flex items-center px-2 py-2 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Folders</span>
        <span className="flex-1" />
        <ChevronLeft className="h-3 w-3 opacity-50" />
      </div>
      <div className="flex-1 overflow-auto py-1">
        {isLoading ? (
          <div className="space-y-1 px-2 py-1">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-3/5" />
          </div>
        ) : (
          tree.map((node) => renderNode(node))
        )}
      </div>
    </div>
  );
}

interface BuildTreeArgs {
  folders: MemoryFolderRecord[];
  departments: Project[];
  activeGoals: Goal[];
  counts: {
    byLayer: Record<LayerKey, number>;
    byDeptDomain: Map<string, number>;
    byGoalActive: Map<string, number>;
    pinned: number;
    pending: number;
    recent: number;
    archived: number;
  };
}

function buildTree({
  folders,
  departments,
  activeGoals,
  counts,
}: BuildTreeArgs): TreeNode[] {
  const top: TreeNode[] = [];

  // Cross-cutting shortcuts at the top.
  top.push({
    key: "__home",
    label: "Home",
    icon: "🏠",
    depth: 0,
    hasChildren: false,
    target: { folder: "", dept: null }, // empty params = home
  });
  top.push({
    key: "__pinned",
    label: "Pinned",
    icon: "📌",
    count: counts.pinned > 0 ? counts.pinned : undefined,
    depth: 0,
    hasChildren: false,
    target: { folder: "__pinned", dept: null },
  });
  top.push({
    key: "__pending",
    label: "Pending Review",
    icon: "📋",
    count: counts.pending > 0 ? counts.pending : undefined,
    depth: 0,
    hasChildren: false,
    target: { folder: "__pending", dept: null },
  });
  top.push({
    key: "__recent",
    label: "Recent",
    icon: "🕒",
    count: counts.recent > 0 ? counts.recent : undefined,
    depth: 0,
    hasChildren: false,
    target: { folder: "__recent", dept: null },
  });
  top.push({
    key: "__archived",
    label: "Archived",
    icon: "📦",
    count: counts.archived > 0 ? counts.archived : undefined,
    depth: 0,
    hasChildren: false,
    target: { folder: "__archived", dept: null },
  });

  // Identity layer.
  const companyFolders = folders.filter((f) => f.departmentId === null);
  const companyRoot = companyFolders.find((f) => f.path === "Company");
  const identityChildren: TreeNode[] = [];
  if (companyRoot) {
    identityChildren.push({
      key: "__company",
      label: companyRoot.displayName,
      icon: companyRoot.icon ?? "🏛️",
      depth: 1,
      hasChildren: false,
      target: { folder: "Company", dept: null },
    });
  }
  top.push({
    key: "__layer-identity",
    label: LAYER_META.identity.label,
    icon: LAYER_META.identity.icon,
    count: counts.byLayer.identity, // always show, even 0 — spec §3 "predictable structure"
    depth: 0,
    hasChildren: identityChildren.length > 0,
    target: { folder: "", dept: null, layer: "identity" },
    children: identityChildren,
  });

  // Domain layer (departments + their seeded subfolders).
  const deptFolderGroups = new Map<string, MemoryFolderRecord[]>();
  for (const f of folders) {
    if (f.departmentId !== null) {
      const arr = deptFolderGroups.get(f.departmentId) ?? [];
      arr.push(f);
      deptFolderGroups.set(f.departmentId, arr);
    }
  }
  const domainChildren: TreeNode[] = [];
  for (const dept of departments) {
    const slug = dept.urlKey ?? "";
    const deptCount = counts.byDeptDomain.get(dept.id) ?? 0;
    const deptFolders = deptFolderGroups.get(dept.id) ?? [];
    // Phase 6.2a: per spec §3, dept's seeded subfolders are NOT shown in tree.
    // We keep this loop for forward-compat with 6.2b user folders.
    // For now we keep children empty; user folders show up in 6.2b.
    void deptFolders;
    domainChildren.push({
      key: `dept-${dept.id}`,
      label: dept.name,
      icon: "📁",
      count: deptCount, // always show, even 0
      depth: 1,
      hasChildren: false,
      target: { folder: slug, dept: dept.id },
    });
  }
  top.push({
    key: "__layer-domain",
    label: LAYER_META.domain.label,
    icon: LAYER_META.domain.icon,
    count: counts.byLayer.domain, // always show, even 0
    depth: 0,
    hasChildren: domainChildren.length > 0,
    target: { folder: "", dept: null, layer: "domain" },
    children: domainChildren,
  });

  // Active Context layer (active goals only).
  const activeChildren: TreeNode[] = activeGoals.map<TreeNode>((g) => ({
    key: `__goal-${g.id}`,
    label: g.title,
    icon: "🎯",
    count: counts.byGoalActive.get(g.id) ?? 0, // always show, even 0
    depth: 1,
    hasChildren: false,
    target: { folder: `__goal-${g.id}`, dept: null, goal: g.id },
  }));
  top.push({
    key: "__layer-active_context",
    label: LAYER_META.active_context.label,
    icon: LAYER_META.active_context.icon,
    count: counts.byLayer.active_context, // always show, even 0
    depth: 0,
    hasChildren: activeChildren.length > 0,
    target: { folder: "", dept: null, layer: "active_context" },
    children: activeChildren,
  });

  // Working layer (flat — no children even when expanded).
  top.push({
    key: "__layer-working",
    label: LAYER_META.working.label,
    icon: LAYER_META.working.icon,
    count: counts.byLayer.working, // always show, even 0
    depth: 0,
    hasChildren: false,
    target: { folder: "", dept: null, layer: "working" },
  });

  return top;
}
