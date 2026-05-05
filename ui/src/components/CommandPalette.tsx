import { useState, useEffect, useDeferredValue, useMemo } from "react";
import { useNavigate } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import type { GlobalSearchEntityType, GlobalSearchResult } from "@armyofagents/shared";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useSidebar } from "../context/SidebarContext";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { searchApi } from "../api/search";
import { queryKeys } from "../lib/queryKeys";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  CircleDot,
  Bot,
  Hexagon,
  Target,
  LayoutDashboard,
  Inbox,
  Settings,
  SquarePen,
  Plus,
  FileText,
  ArrowLeftRight,
  Brain,
  Lightbulb,
  FolderSearch,
} from "lucide-react";
import { Identity } from "./Identity";
import { agentUrl, projectUrl } from "../lib/utils";
import { Badge } from "@/components/ui/badge";

const TYPE_ICONS: Record<GlobalSearchEntityType, typeof CircleDot> = {
  task: CircleDot,
  goal: Target,
  agent: Bot,
  brief: FileText,
  memory: Brain,
  artifact: FolderSearch,
  suggestion: Lightbulb,
};

function SearchResultBadges({ result }: { result: GlobalSearchResult }) {
  if (result.type === "memory") {
    return (
      <>
        {result.layer && (
          <Badge variant="outline" className="hidden sm:inline-flex">
            {result.layer.replace("_", " ")}
          </Badge>
        )}
        {result.departmentName && (
          <Badge variant="outline" className="hidden md:inline-flex">
            {result.departmentName}
          </Badge>
        )}
        {result.category && (
          <Badge variant="outline" className="hidden md:inline-flex capitalize">
            {result.category}
          </Badge>
        )}
      </>
    );
  }

  if (result.type === "artifact") {
    return (
      <>
        {result.artifactType && (
          <Badge variant="outline" className="hidden sm:inline-flex capitalize">
            {result.artifactType}
          </Badge>
        )}
        {typeof result.currentVersionNumber === "number" && (
          <Badge variant="outline" className="hidden md:inline-flex">
            v{result.currentVersionNumber}
          </Badge>
        )}
      </>
    );
  }

  if (result.type === "suggestion" && result.suggestionCategory) {
    return (
      <Badge variant="outline" className="hidden md:inline-flex capitalize">
        {result.suggestionCategory.replace("_", " ")}
      </Badge>
    );
  }

  if (result.status) {
    return (
      <Badge variant="outline" className="hidden md:inline-flex capitalize">
        {result.status.replace("_", " ")}
      </Badge>
    );
  }

  return null;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompany();
  const { openNewIssue, openNewAgent, openNewGoal, openDiscussionCapture } = useDialog();
  const { isMobile, setSidebarOpen } = useSidebar();
  const deferredQuery = useDeferredValue(query);
  const searchQuery = deferredQuery.trim();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(true);
        if (isMobile) setSidebarOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isMobile, setSidebarOpen]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const { data: issues = [] } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && open,
  });

  const { data: searchedIssues = [] } = useQuery({
    queryKey: queryKeys.issues.search(selectedCompanyId!, searchQuery),
    queryFn: () => issuesApi.list(selectedCompanyId!, { q: searchQuery }),
    enabled: !!selectedCompanyId && open && searchQuery.length > 0,
  });

  const { data: globalSearch } = useQuery({
    queryKey: queryKeys.search.global(selectedCompanyId!, searchQuery),
    queryFn: () => searchApi.global(selectedCompanyId!, searchQuery, { limitPerType: 8 }),
    enabled: !!selectedCompanyId && open && searchQuery.length > 0,
  });

  const { data: agents = [] } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && open,
  });

  const { data: projects = [] } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && open,
  });

  function go(path: string) {
    setOpen(false);
    navigate(path);
  }

  const agentName = (id: string | null) => {
    if (!id) return null;
    return agents.find((a) => a.id === id)?.name ?? null;
  };

  const visibleIssues = useMemo(
    () => (searchQuery.length > 0 ? searchedIssues : issues),
    [issues, searchedIssues, searchQuery],
  );
  const groupedSearchResults = globalSearch?.groups ?? [];

  return (
    <CommandDialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value && isMobile) setSidebarOpen(false);
      }}
    >
      <CommandInput
        placeholder="Search tasks, goals, agents, discussions, memory, artifacts..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem
            onSelect={() => {
              setOpen(false);
              openNewIssue();
            }}
          >
            <SquarePen className="mr-2 h-4 w-4" />
            New Task
            <span className="ml-auto text-xs text-muted-foreground">C</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setOpen(false);
              openDiscussionCapture();
            }}
          >
            <FileText className="mr-2 h-4 w-4" />
            New Discussion
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setOpen(false);
              openNewGoal();
            }}
          >
            <Target className="mr-2 h-4 w-4" />
            New Goal
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setOpen(false);
              openNewAgent();
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Agent
          </CommandItem>
          <CommandItem onSelect={() => go("/projects")}>
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setOpen(false);
              navigate("/");
            }}
          >
            <ArrowLeftRight className="mr-2 h-4 w-4" />
            Switch Company
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Pages">
          <CommandItem onSelect={() => go("/home")}>
            <LayoutDashboard className="mr-2 h-4 w-4" />
            Home
          </CommandItem>
          <CommandItem onSelect={() => go("/inbox")}>
            <Inbox className="mr-2 h-4 w-4" />
            Inbox
          </CommandItem>
          <CommandItem onSelect={() => go("/issues")}>
            <CircleDot className="mr-2 h-4 w-4" />
            Tasks
          </CommandItem>
          <CommandItem onSelect={() => go("/projects")}>
            <Hexagon className="mr-2 h-4 w-4" />
            Projects
          </CommandItem>
          <CommandItem onSelect={() => go("/goals")}>
            <Target className="mr-2 h-4 w-4" />
            Goals
          </CommandItem>
          <CommandItem onSelect={() => go("/agents")}>
            <Bot className="mr-2 h-4 w-4" />
            Agents
          </CommandItem>
          <CommandItem onSelect={() => go("/settings")}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </CommandItem>
        </CommandGroup>

        {searchQuery.length > 0 && groupedSearchResults.length > 0 && (
          <>
            <CommandSeparator />
            {groupedSearchResults.map((group) => (
              <CommandGroup key={group.type} heading={`${group.label} (${group.count})`}>
                {group.items.map((result) => {
                  const Icon = TYPE_ICONS[result.type];
                  return (
                    <CommandItem
                      key={`${result.type}-${result.id}`}
                      value={`${group.label} ${result.identifier ?? ""} ${result.title} ${result.subtitle ?? ""}`}
                      onSelect={() => go(result.href)}
                    >
                      <Icon className="mr-2 h-4 w-4" />
                      {result.type === "task" && result.identifier ? (
                        <span className="text-muted-foreground mr-2 font-mono text-xs">
                          {result.identifier}
                        </span>
                      ) : null}
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{result.title}</span>
                        {result.subtitle ? (
                          <span className="text-muted-foreground truncate text-xs">
                            {result.subtitle}
                          </span>
                        ) : null}
                      </div>
                      <div className="ml-2 flex items-center gap-1">
                        <SearchResultBadges result={result} />
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </>
        )}

        {searchQuery.length === 0 && visibleIssues.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Tasks">
              {visibleIssues.slice(0, 10).map((issue) => (
                <CommandItem
                  key={issue.id}
                  value={issue.identifier ? `${issue.identifier} ${issue.title}` : issue.title}
                  onSelect={() => go(`/issues/${issue.identifier ?? issue.id}`)}
                >
                  <CircleDot className="mr-2 h-4 w-4" />
                  <span className="text-muted-foreground mr-2 font-mono text-xs">
                    {issue.identifier ?? issue.id.slice(0, 8)}
                  </span>
                  <span className="flex-1 truncate">{issue.title}</span>
                  {issue.assigneeAgentId && (() => {
                    const name = agentName(issue.assigneeAgentId);
                    return name ? (
                      <Identity name={name} size="sm" className="ml-2 hidden sm:inline-flex" />
                    ) : null;
                  })()}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {searchQuery.length === 0 && agents.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Agents">
              {agents.slice(0, 10).map((agent) => (
                <CommandItem key={agent.id} onSelect={() => go(agentUrl(agent))}>
                  <Bot className="mr-2 h-4 w-4" />
                  {agent.name}
                  <span className="text-xs text-muted-foreground ml-2">{agent.role}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {searchQuery.length === 0 && projects.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Projects">
              {projects.slice(0, 10).map((project) => (
                <CommandItem key={project.id} onSelect={() => go(projectUrl(project))}>
                  <Hexagon className="mr-2 h-4 w-4" />
                  {project.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
