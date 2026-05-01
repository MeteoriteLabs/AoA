import { eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { marketplaceCompanySettings } from "@armyofagents/db";
import type { MarketplaceSettings } from "@armyofagents/shared";
import { MARKETPLACE_SETTINGS_DEFAULTS } from "@armyofagents/shared";

const ALLOWED_KEYS = new Set(Object.keys(MARKETPLACE_SETTINGS_DEFAULTS));

/**
 * Merge stored partial settings with defaults, stripping unknown keys.
 */
export function mergeWithDefaults(stored: Record<string, unknown>): MarketplaceSettings {
  const merged: Record<string, unknown> = { ...MARKETPLACE_SETTINGS_DEFAULTS };
  for (const key of ALLOWED_KEYS) {
    if (key in stored && stored[key] !== undefined) {
      merged[key] = stored[key];
    }
  }
  return merged as unknown as MarketplaceSettings;
}

export function marketplaceSettingsService(db: Db) {
  return {
    async get(companyId: string): Promise<MarketplaceSettings> {
      const rows = await db
        .select()
        .from(marketplaceCompanySettings)
        .where(eq(marketplaceCompanySettings.companyId, companyId));
      const stored = (rows[0]?.settings ?? {}) as Record<string, unknown>;
      return mergeWithDefaults(stored);
    },

    async patch(companyId: string, patch: Partial<MarketplaceSettings>): Promise<MarketplaceSettings> {
      const current = await this.get(companyId);
      const merged: Record<string, unknown> = { ...current };
      for (const [key, value] of Object.entries(patch)) {
        if (ALLOWED_KEYS.has(key)) merged[key] = value;
      }

      const existing = await db
        .select({ id: marketplaceCompanySettings.id })
        .from(marketplaceCompanySettings)
        .where(eq(marketplaceCompanySettings.companyId, companyId));

      if (existing.length > 0) {
        await db
          .update(marketplaceCompanySettings)
          .set({ settings: merged, updatedAt: new Date() })
          .where(eq(marketplaceCompanySettings.companyId, companyId));
      } else {
        await db
          .insert(marketplaceCompanySettings)
          .values({ companyId, settings: merged });
      }

      return mergeWithDefaults(merged);
    },
  };
}
