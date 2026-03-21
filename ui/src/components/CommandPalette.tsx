import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import type { SearchResult, SearchResultsGrouped } from "@paperclipai/shared";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useSidebar } from "../context/SidebarContext";
import { memoryApi } from "../api/memory";
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
  Brain,
  Target,
  LayoutDashboard,
  Inbox,
  Settings,
  SquarePen,
  Plus,
  FileText,
  ArrowLeftRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { agentUrl } from "../lib/utils";

const EMPTY_GROUPS: SearchResultsGrouped = {
  tasks: [],
  goals: [],
  agents: [],
  memory: [],
};

export function mergeMemorySemanticScores(
  grouped: SearchResultsGrouped,
  semanticResults: Array<{ id: string; similarity: number | null }>,
): SearchResultsGrouped {
  if (semanticResults.length === 0) return grouped;

  const similarityById = new Map(
    semanticResults.map((result) => [result.id, result.similarity ?? null]),
  );

  return {
    ...grouped,
    memory: grouped.memory.map((result) => ({
      ...result,
      score: similarityById.get(result.id) ?? result.score,
    })),
  };
}

function hasSearchResults(grouped: SearchResultsGrouped) {
  return Object.values(grouped).some((results) => results.length > 0);
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompany();
  const { openNewIssue, openNewAgent, openNewGoal, openDebrief } = useDialog();
  const { isMobile, setSidebarOpen } = useSidebar();
  const searchQuery = query.trim();

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

  const { data: groupedResults = EMPTY_GROUPS } = useQuery({
    queryKey: queryKeys.search.global(selectedCompanyId!, searchQuery),
    queryFn: () => searchApi.search(selectedCompanyId!, searchQuery),
    enabled: !!selectedCompanyId && open,
  });

  const { data: semanticMemoryResults = [] } = useQuery({
    queryKey: queryKeys.memory.semanticSearch(selectedCompanyId!, searchQuery),
    queryFn: () => memoryApi.searchSemantic(selectedCompanyId!, searchQuery, { limit: 8 }),
    enabled: !!selectedCompanyId && open && searchQuery.length > 0,
  });

  function go(path: string) {
    setOpen(false);
    navigate(path);
  }

  const results = useMemo(
    () => mergeMemorySemanticScores(groupedResults, semanticMemoryResults),
    [groupedResults, semanticMemoryResults],
  );

  return (
    <CommandDialog open={open} onOpenChange={(v) => {
        setOpen(v);
        if (v && isMobile) setSidebarOpen(false);
      }}>
      <CommandInput
        placeholder="Search tasks, goals, agents, memory..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {searchQuery.length > 0 && !hasSearchResults(results) && (
          <CommandEmpty>No search results found.</CommandEmpty>
        )}

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
              openDebrief();
            }}
          >
            <FileText className="mr-2 h-4 w-4" />
            New Debrief
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
          <CommandItem onSelect={() => {
            setOpen(false);
            navigate("/");
          }}>
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

        {results.tasks.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Tasks">
              {results.tasks.map((issue) => (
                <CommandItem
                  key={issue.id}
                  value={`${issue.identifier ?? ""} ${issue.title} ${issue.subtitle ?? ""}`}
                  onSelect={() => go(`/issues/${issue.identifier ?? issue.id}`)}
                >
                  <CircleDot className="mr-2 h-4 w-4" />
                  <span className="text-muted-foreground mr-2 font-mono text-xs">
                    {issue.identifier ?? issue.id.slice(0, 8)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{issue.title}</div>
                    {issue.subtitle && (
                      <div className="truncate text-xs text-muted-foreground">
                        {issue.subtitle}
                      </div>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {results.goals.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Goals">
              {results.goals.map((goal) => (
                <CommandItem
                  key={goal.id}
                  value={`${goal.title} ${goal.subtitle ?? ""}`}
                  onSelect={() => go(`/goals/${goal.id}`)}
                >
                  <Target className="mr-2 h-4 w-4" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{goal.title}</div>
                    {goal.subtitle && (
                      <div className="truncate text-xs text-muted-foreground">
                        {goal.subtitle}
                      </div>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {results.agents.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Agents">
              {results.agents.map((agent) => (
                <CommandItem
                  key={agent.id}
                  value={`${agent.title} ${agent.role ?? ""}`}
                  onSelect={() => go(agentUrl({ id: agent.id, name: agent.title }))}
                >
                  <Bot className="mr-2 h-4 w-4" />
                  <span className="flex-1 truncate">{agent.title}</span>
                  {agent.role && (
                    <span className="text-xs text-muted-foreground ml-2 capitalize">
                      {agent.role}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {results.memory.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Memory">
              {results.memory.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.title} ${item.subtitle ?? ""} ${item.layer ?? ""} ${item.departmentName ?? ""} ${item.category ?? ""}`}
                  onSelect={() => go(`/memory?selected=${encodeURIComponent(item.id)}`)}
                >
                  <Brain className="mr-2 h-4 w-4" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{item.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {item.layer && (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                          {item.layer.replace("_", " ")}
                        </Badge>
                      )}
                      {item.departmentName && (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                          {item.departmentName}
                        </Badge>
                      )}
                      {item.category && (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] capitalize">
                          {item.category}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {searchQuery.length > 0 && item.score > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {Math.round(item.score * 100)}%
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
