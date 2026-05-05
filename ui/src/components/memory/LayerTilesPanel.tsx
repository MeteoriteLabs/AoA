import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { Building, Building2, Clock, Zap, type LucideIcon } from "lucide-react";
import { memoryApi } from "../../api/memory";
import { queryKeys } from "../../lib/queryKeys";
import { useCompany } from "../../context/CompanyContext";
import { cn } from "@/lib/utils";
import type { MemoryItem } from "@armyofagents/shared";

interface LayerTilesPanelProps {
  companyId: string;
}

type LayerKey = "identity" | "domain" | "active_context" | "working";

interface LayerSpec {
  key: LayerKey;
  label: string;
  icon: LucideIcon;
  emoji: string;
  description: string;
}

const LAYERS: LayerSpec[] = [
  {
    key: "identity",
    label: "Identity",
    icon: Building,
    emoji: "🪪",
    description: "Permanent — always in agent context",
  },
  {
    key: "domain",
    label: "Domain",
    icon: Building2,
    emoji: "🏢",
    description: "Department-scoped knowledge",
  },
  {
    key: "active_context",
    label: "Active Context",
    icon: Clock,
    emoji: "🎯",
    description: "Goal-scoped, expires",
  },
  {
    key: "working",
    label: "Working",
    icon: Zap,
    emoji: "⚡",
    description: "Task-ephemeral, 7d auto-archive",
  },
];

export function LayerTilesPanel({ companyId }: LayerTilesPanelProps) {
  const navigate = useNavigate();
  const { selectedCompany } = useCompany();
  const companyPrefix =
    (selectedCompany as { issuePrefix?: string } | null)?.issuePrefix ?? "";

  const { data: items } = useQuery({
    queryKey: queryKeys.memory.list(companyId),
    queryFn: () => memoryApi.list(companyId, {}),
    enabled: Boolean(companyId),
  });

  const counts = useMemo(() => {
    const result: Record<LayerKey, { total: number; pending: number }> = {
      identity: { total: 0, pending: 0 },
      domain: { total: 0, pending: 0 },
      active_context: { total: 0, pending: 0 },
      working: { total: 0, pending: 0 },
    };
    for (const it of (items ?? []) as Array<MemoryItem & { layer?: string }>) {
      const layer = it.layer as LayerKey | undefined;
      if (!layer || !(layer in result)) continue;
      result[layer].total += 1;
      if (it.status === "pending") result[layer].pending += 1;
    }
    return result;
  }, [items]);

  function openLayer(layer: LayerKey) {
    navigate(`/${companyPrefix}/memory/explore?layer=${layer}`);
  }

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">
        Layers
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        {LAYERS.map((layer) => {
          const c = counts[layer.key];
          const itemLabel = c.total === 1 ? "item" : "items";
          return (
            <button
              key={layer.key}
              onClick={() => openLayer(layer.key)}
              className={cn(
                "text-left p-4 rounded-md border border-border bg-card",
                "hover:border-primary/50 hover:shadow-md transition-all duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base leading-none">{layer.emoji}</span>
                <div className="font-medium text-sm">{layer.label}</div>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {c.total} {itemLabel}
              </div>
              {c.pending > 0 && (
                <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
                  ⏳ {c.pending} pending
                </div>
              )}
              <div className="text-[10px] text-muted-foreground/60 mt-2 leading-snug">
                {layer.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
