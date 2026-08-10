export interface JobReadyHint {
  organizationId: string;
  attemptId: string;
}

export interface JobReadyScheduler {
  hint(hint: JobReadyHint): boolean;
  take(organizationId: string, limit?: number): string[];
  nextOrganization(): string | null;
  size(): { organizations: number; hints: number };
}

/**
 * Bounded identifier-only fairness hints. This process-local structure is never
 * lease authority: worker poll always returns to PostgreSQL and rechecks the
 * placement and row locks, so a lost hint or restart cannot lose work.
 */
export function createJobReadyScheduler(input: {
  maxOrganizationShards?: number;
  maxHintsPerShard?: number;
} = {}): JobReadyScheduler {
  const maxOrganizations = Math.max(1, Math.min(32, input.maxOrganizationShards ?? 32));
  const maxHints = Math.max(1, Math.min(1_024, input.maxHintsPerShard ?? 128));
  const shards = new Map<string, Set<string>>();
  let cursor = 0;

  function boundedLimit(limit: number | undefined): number {
    return Math.max(1, Math.min(maxHints, Math.floor(limit ?? maxHints)));
  }

  return {
    hint(hint) {
      let shard = shards.get(hint.organizationId);
      if (!shard) {
        if (shards.size >= maxOrganizations) return false;
        shard = new Set<string>();
        shards.set(hint.organizationId, shard);
      }
      if (shard.has(hint.attemptId)) return true;
      if (shard.size >= maxHints) return false;
      shard.add(hint.attemptId);
      return true;
    },
    take(organizationId, limit) {
      const shard = shards.get(organizationId);
      if (!shard) return [];
      const values = [...shard].slice(0, boundedLimit(limit));
      for (const value of values) shard.delete(value);
      if (shard.size === 0) shards.delete(organizationId);
      return values;
    },
    nextOrganization() {
      const organizations = [...shards.keys()];
      if (organizations.length === 0) return null;
      cursor %= organizations.length;
      const selected = organizations[cursor]!;
      cursor = (cursor + 1) % organizations.length;
      return selected;
    },
    size() {
      return {
        organizations: shards.size,
        hints: [...shards.values()].reduce((sum, shard) => sum + shard.size, 0),
      };
    },
  };
}
