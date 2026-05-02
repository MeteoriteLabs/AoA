import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { ChevronLeft } from "lucide-react";
import type { MemoryFolderRecord, Project } from "@armyofagents/shared";
import { memoryFoldersApi } from "../../api/memoryFolders";
import { projectsApi } from "../../api/projects";
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
  target: { folder: string; dept: string | null };
  sortOrder?: number;
  tintClass?: string;
  children?: TreeNode[];
}

export function MemoryTree({
  companyId,
  selectedFolderPath,
  selectedDepartmentId,
}: MemoryTreeProps) {
  const navigate = useNavigate();
  const { selectedCompany } = useCompany();
  const companyPrefix = selectedCompany?.issuePrefix ?? "";
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(["__company"]),
  );

  const { data: folders, isLoading: foldersLoading } = useQuery({
    queryKey: queryKeys.memory.folders.list(companyId),
    queryFn: () => memoryFoldersApi.list(companyId),
  });

  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: queryKeys.projects.list(companyId),
    queryFn: () => projectsApi.list(companyId),
  });

  const departments = useMemo<Project[]>(
    () =>
      (projects ?? []).filter(
        (p: Project) => p.type === "department" && !p.archivedAt,
      ),
    [projects],
  );

  const tree = useMemo(() => buildTree(folders ?? [], departments), [
    folders,
    departments,
  ]);

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectNode(target: TreeNode["target"]) {
    const params = new URLSearchParams();
    if (target.folder) params.set("folder", target.folder);
    if (target.dept) params.set("dept", target.dept);
    navigate(`/${companyPrefix}/memory/explore?${params.toString()}`);
  }

  function isSelected(target: TreeNode["target"]): boolean {
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
          onSelect={() => selectNode(node.target)}
          tintClass={node.tintClass}
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

function buildTree(
  folders: MemoryFolderRecord[],
  departments: Project[],
): TreeNode[] {
  const companyFolders = folders.filter((f) => f.departmentId === null);
  const deptFolderGroups = new Map<string, MemoryFolderRecord[]>();
  for (const f of folders) {
    if (f.departmentId !== null) {
      const arr = deptFolderGroups.get(f.departmentId) ?? [];
      arr.push(f);
      deptFolderGroups.set(f.departmentId, arr);
    }
  }

  const top: TreeNode[] = [];

  top.push({
    key: "__pinned",
    label: "Pinned",
    icon: "📌",
    depth: 0,
    hasChildren: false,
    target: { folder: "__pinned", dept: null },
  });

  const companyRoot = companyFolders.find((f) => f.path === "Company");
  if (companyRoot) {
    top.push({
      key: "__company",
      label: companyRoot.displayName,
      icon: companyRoot.icon ?? "🏛️",
      depth: 0,
      hasChildren: false,
      target: { folder: "Company", dept: null },
    });
  }

  for (const dept of departments) {
    const slug = dept.urlKey ?? "";
    const deptFolders = deptFolderGroups.get(dept.id) ?? [];
    const children = deptFolders
      .filter((f) => {
        const parts = f.path.split("/");
        return parts.length === 2 && parts[0] === slug;
      })
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map<TreeNode>((f) => ({
        key: `dept-${dept.id}-${f.id}`,
        label: f.displayName,
        icon: f.icon ?? undefined,
        depth: 1,
        hasChildren: false,
        target: { folder: f.path, dept: dept.id },
      }));

    top.push({
      key: `dept-${dept.id}`,
      label: dept.name,
      icon: "📁",
      depth: 0,
      hasChildren: children.length > 0,
      target: { folder: slug, dept: dept.id },
      children,
    });
  }

  return top;
}
