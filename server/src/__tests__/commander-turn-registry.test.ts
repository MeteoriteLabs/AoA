import { describe, it, expect } from "vitest";
import {
  claimCommanderTurn,
  commanderTurnKey,
  isCommanderTurnInFlight,
  releaseCommanderTurn,
  tryClaimCommanderTurn,
} from "../services/internal-agent/commander-turn-registry.js";

// PR #291 round-4 review: the turn claim must be an ATOMIC try-claim so two
// near-simultaneous retries cannot both acquire the same key and double-run.
describe("commander-turn-registry — atomic tryClaim", () => {
  it("first tryClaim wins (true), a second for the same key loses (false)", () => {
    const key = commanderTurnKey("conv-A", "sub-1");
    try {
      expect(tryClaimCommanderTurn(key)).toBe(true);
      // No await between the two calls — the loser must observe it as held.
      expect(tryClaimCommanderTurn(key)).toBe(false);
      expect(isCommanderTurnInFlight(key)).toBe(true);
    } finally {
      releaseCommanderTurn(key);
    }
  });

  it("a released key can be re-claimed (Retry recovery for a dead turn)", () => {
    const key = commanderTurnKey("conv-A", "sub-2");
    expect(tryClaimCommanderTurn(key)).toBe(true);
    releaseCommanderTurn(key);
    expect(isCommanderTurnInFlight(key)).toBe(false);
    expect(tryClaimCommanderTurn(key)).toBe(true);
    releaseCommanderTurn(key);
  });

  it("tryClaim loses against a plain claim already held (fresh-path winner)", () => {
    const key = commanderTurnKey("conv-B", "sub-3");
    claimCommanderTurn(key);
    try {
      expect(tryClaimCommanderTurn(key)).toBe(false);
    } finally {
      releaseCommanderTurn(key);
    }
  });

  it("distinct keys are independent", () => {
    const a = commanderTurnKey("conv-C", "sub-x");
    const b = commanderTurnKey("conv-C", "sub-y");
    try {
      expect(tryClaimCommanderTurn(a)).toBe(true);
      expect(tryClaimCommanderTurn(b)).toBe(true);
    } finally {
      releaseCommanderTurn(a);
      releaseCommanderTurn(b);
    }
  });
});
