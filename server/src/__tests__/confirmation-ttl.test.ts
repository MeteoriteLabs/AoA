import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIRMATION_TTL_MS } from "../routes/internal-agent.js";

// These tests verify the TTL algorithm logic in isolation using fake timers.
// They do not spin up the Express app — they replicate the store pattern
// to verify correctness before it's applied to the route file.
describe("pendingConfirmations TTL logic", () => {

  interface Entry { data: string; expiresAt: number; }
  let store: Map<string, Entry>;

  function addEntry(id: string) {
    store.set(id, { data: "payload", expiresAt: Date.now() + CONFIRMATION_TTL_MS });
  }

  function getEntry(id: string): Entry | undefined {
    const entry = store.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      store.delete(id);
      return undefined;
    }
    return entry;
  }

  function sweepExpired() {
    const now = Date.now();
    for (const [id, entry] of store) {
      if (entry.expiresAt < now) store.delete(id);
    }
  }

  beforeEach(() => {
    store = new Map();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns entry when accessed within TTL", () => {
    addEntry("id-1");
    vi.advanceTimersByTime(29 * 60 * 1000); // 29 min — within TTL
    expect(getEntry("id-1")).toBeDefined();
  });

  it("returns undefined and deletes entry after TTL expires", () => {
    addEntry("id-2");
    vi.advanceTimersByTime(31 * 60 * 1000); // 31 min — past TTL
    expect(getEntry("id-2")).toBeUndefined();
    expect(store.has("id-2")).toBe(false);
  });

  it("sweep removes all expired entries", () => {
    addEntry("id-3");
    addEntry("id-4");
    vi.advanceTimersByTime(31 * 60 * 1000);
    sweepExpired();
    expect(store.size).toBe(0);
  });

  it("sweep does not remove unexpired entries", () => {
    addEntry("id-5");
    vi.advanceTimersByTime(1 * 60 * 1000); // 1 min — still valid
    sweepExpired();
    expect(store.has("id-5")).toBe(true);
  });
});
