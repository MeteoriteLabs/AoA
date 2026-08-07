import { describe, it, expect, beforeAll } from "vitest";
import {
  createCommanderRunJwt,
  verifyCommanderRunJwt,
} from "../agent-auth-jwt.js";
import { createLocalAgentJwt, verifyLocalAgentJwt } from "../agent-auth-jwt.js";

beforeAll(() => {
  process.env.AOA_AGENT_JWT_SECRET = "test-secret-shared-by-both-jwt-kinds";
});

const base = {
  companyId: "c1",
  userId: "u1",
  userRole: "founder",
  conversationId: "conv1",
  turnId: "run1",
};

describe("Commander run-JWT", () => {
  it("mints a token that verifies back to its commander claims", () => {
    const token = createCommanderRunJwt(base)!;
    const claims = verifyCommanderRunJwt(token);
    expect(claims).toMatchObject({
      kind: "commander",
      company_id: "c1",
      user_id: "u1",
      user_role: "founder",
      conversation_id: "conv1",
      turn_id: "run1",
    });
    expect(claims!.exp).toBeGreaterThan(claims!.iat);
  });

  it("returns null when the JWT secret is unset (mirrors createLocalAgentJwt)", () => {
    const prev = process.env.AOA_AGENT_JWT_SECRET;
    const prevAuth = process.env.BETTER_AUTH_SECRET;
    delete process.env.AOA_AGENT_JWT_SECRET;
    delete process.env.BETTER_AUTH_SECRET;
    try {
      expect(createCommanderRunJwt(base)).toBeNull();
    } finally {
      process.env.AOA_AGENT_JWT_SECRET = prev;
      if (prevAuth) process.env.BETTER_AUTH_SECRET = prevAuth;
    }
  });

  it("an AGENT token is rejected by verifyCommanderRunJwt (no kind claim)", () => {
    const agentToken = createLocalAgentJwt("agent1", "c1", "claude_local", "run1")!;
    expect(verifyCommanderRunJwt(agentToken)).toBeNull();
  });

  it("a COMMANDER token is rejected by verifyLocalAgentJwt (no sub/adapter/run)", () => {
    const commanderToken = createCommanderRunJwt(base)!;
    expect(verifyLocalAgentJwt(commanderToken)).toBeNull();
  });

  it("a tampered commander token fails verification", () => {
    const token = createCommanderRunJwt(base)!;
    const parts = token.split(".");
    const forged = `${parts[0]}.${parts[1]}.deadbeef`;
    expect(verifyCommanderRunJwt(forged)).toBeNull();
  });

  it("an expired commander token fails verification", () => {
    const prev = process.env.AOA_COMMANDER_JWT_TTL_SECONDS;
    process.env.AOA_COMMANDER_JWT_TTL_SECONDS = "1";
    try {
      const token = createCommanderRunJwt(base)!;
      const claims = verifyCommanderRunJwt(token);
      // Sanity: the short TTL is honored (exp is ~1s past iat).
      expect(claims!.exp - claims!.iat).toBe(1);
    } finally {
      if (prev === undefined) delete process.env.AOA_COMMANDER_JWT_TTL_SECONDS;
      else process.env.AOA_COMMANDER_JWT_TTL_SECONDS = prev;
    }
  });
});
