import { useLayoutEffect, useMemo, useState } from "react";
import { Bot, Home, Puzzle, Sparkles, Users } from "lucide-react";
import type { MarketplaceItemType } from "@armyofagents/shared";
import { useNavigate, useOutletContext } from "@/lib/router";
import { useCatalog } from "@/hooks/useCatalog";
import { isAoaItem } from "@/lib/marketplace-constants";
import {
  SecondarySidebar,
  type SecondarySidebarItem,
  type SecondarySidebarSection,
} from "@/components/SecondarySidebar";
import type { LobbyOutletContext } from "@/components/LobbyLayout";

export type MarketplaceSidebarKey = "home" | MarketplaceItemType | "aoa";

/**
 * Builds the marketplace floating secondary sidebar (Home / Skills / Plugins /
 * Agents / Teams | AoA), pushes it to the persistent LobbyLayout via the outlet
 * context, and returns `pillItems` for the mobile sub-nav (§8.6). Type counts
 * exclude AoA items; the AoA entry counts AoA-first-party items. Called by every
 * marketplace page so the sidebar chrome is consistent.
 */
export function useMarketplaceSidebar(activeKey: MarketplaceSidebarKey): {
  pillItems: SecondarySidebarItem[];
} {
  const { setSecondarySidebar } = useOutletContext<LobbyOutletContext>();
  const navigate = useNavigate();
  const { data: catalog } = useCatalog();
  const [collapsed, setCollapsed] = useState(false);

  const counts = useMemo(() => {
    const items = catalog?.items ?? [];
    const main = items.filter((i) => !isAoaItem(i));
    return {
      home: main.length,
      skill: main.filter((i) => i.type === "skill").length,
      plugin: main.filter((i) => i.type === "plugin").length,
      agent: main.filter((i) => i.type === "agent").length,
      team: main.filter((i) => i.type === "team").length,
      aoa: items.filter(isAoaItem).length,
    };
  }, [catalog]);

  const pillItems = useMemo<SecondarySidebarItem[]>(() => {
    const go = (key: MarketplaceSidebarKey) => {
      if (key === "home") navigate("/marketplace");
      else if (key === "aoa") navigate("/marketplace?view=aoa");
      else navigate(`/marketplace?type=${key}`);
    };
    const mk = (
      id: MarketplaceSidebarKey,
      label: string,
      icon: SecondarySidebarItem["icon"],
    ): SecondarySidebarItem => ({
      id,
      label,
      icon,
      count: counts[id as keyof typeof counts],
      active: activeKey === id,
      onClick: () => go(id),
    });
    return [
      mk("home", "Home", <Home />),
      mk("skill", "Skills", <Sparkles />),
      mk("plugin", "Plugins", <Puzzle />),
      mk("agent", "Agents", <Bot />),
      mk("team", "Teams", <Users />),
      mk("aoa", "AoA", <Sparkles className="text-brand" />),
    ];
  }, [counts, activeKey, navigate]);

  const sections = useMemo<SecondarySidebarSection[]>(
    () => [{ items: pillItems.slice(0, 5) }, { items: pillItems.slice(5) }],
    [pillItems],
  );

  useLayoutEffect(() => {
    setSecondarySidebar(
      <SecondarySidebar
        sections={sections}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        floating
      />,
    );
    return () => setSecondarySidebar(null);
  }, [setSecondarySidebar, sections, collapsed]);

  return { pillItems };
}
