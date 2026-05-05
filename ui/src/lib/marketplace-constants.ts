import { BookOpen, Bot, Plug, Users, type LucideIcon } from "lucide-react";
import type { MarketplaceItemType } from "@armyofagents/shared";

/** Type-default icons. */
export const TYPE_ICONS: Record<MarketplaceItemType, LucideIcon> = {
  skill: BookOpen,
  agent: Bot,
  plugin: Plug,
  team: Users,
};

/** Human-readable singular labels. */
export const TYPE_LABELS: Record<MarketplaceItemType, string> = {
  skill: "Skill",
  agent: "Agent",
  plugin: "Plugin",
  team: "Team",
};

/** Human-readable plural labels (used in URL paths and section headers). */
export const TYPE_LABELS_PLURAL: Record<MarketplaceItemType, string> = {
  skill: "Skills",
  agent: "Agents",
  plugin: "Plugins",
  team: "Teams",
};

/** Trust tier display config. */
export const TRUST_TIER_CONFIG = {
  verified: {
    label: "Verified",
    description: "Reviewed and signed off by AoA team",
    colorClass: "text-green-700 bg-green-50 ring-green-600/20",
    starCount: 3,
  },
  community: {
    label: "Community",
    description: "Published by community member; no AoA review",
    colorClass: "text-blue-700 bg-blue-50 ring-blue-600/20",
    starCount: 2,
  },
  unverified: {
    label: "Unverified",
    description: "No trust signals available",
    colorClass: "text-gray-700 bg-gray-50 ring-gray-600/20",
    starCount: 1,
  },
} as const;

/** Category → lucide icon name (string lookup). Extend as new categories appear. */
export const CATEGORY_ICONS: Record<string, string> = {
  engineering: "Wrench",
  integrations: "Plug",
  research: "Search",
  writing: "PenTool",
  sales: "TrendingUp",
  support: "MessageCircle",
  analytics: "BarChart3",
  design: "Palette",
  operations: "Settings",
  general: "Box",
};

/**
 * URL-path slug → MarketplaceItemType. Accepts both "Skills"/"skills"/"skill".
 * Returns null for unrecognized types (caller renders 404).
 */
export function pathToItemType(slug: string): MarketplaceItemType | null {
  const normalized = slug.toLowerCase().replace(/s$/, "");
  if (
    normalized === "skill" ||
    normalized === "agent" ||
    normalized === "plugin" ||
    normalized === "team"
  ) {
    return normalized as MarketplaceItemType;
  }
  return null;
}
