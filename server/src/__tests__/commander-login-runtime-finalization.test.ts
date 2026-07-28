import { describe, expect, it, vi } from "vitest";
import { makeTableProxy } from "./helpers/drizzle-mock.js";

const runtimeMocks = vi.hoisted(() => ({
  runCodexLogin: vi.fn(),
  readSafeCredentialEvidence: vi.fn(),
  verifyAndBind: vi.fn(async () => ({ credentialIds: ["credential-1"], bindingIds: ["binding-1"] })),
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  eq: (...args: unknown[]) => ({ op: "eq", args }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    sql: strings.join("?"),
    values,
  }),
}));
vi.mock("@armyofagents/db", () => ({
  commanderLoginChallenges: makeTableProxy("commander_login_challenges"),
}));
vi.mock("@armyofagents/adapter-codex-local/server", () => ({
  runCodexLogin: runtimeMocks.runCodexLogin,
  resolveSharedCodexHomeDir: vi.fn(() => "/unused"),
}));
vi.mock("@armyofagents/adapter-claude-local/server", () => ({
  runClaudeLoginStreaming: vi.fn(),
  resolveClaudeConfigHome: vi.fn(() => "/unused"),
  CLAUDE_CREDENTIAL_FILE_NAME: ".credentials.json",
}));
vi.mock("../services/cli-auth-topology.js", () => ({
  assertProviderLoginUrl: (_provider: string, url: string) => url,
  prepareScopedCliAuthHome: () => "/scoped/openai",
  scopedCliAuthEnv: (env: NodeJS.ProcessEnv) => env,
}));
vi.mock("../services/provider-credentials.js", () => ({
  readSafeCredentialEvidence: runtimeMocks.readSafeCredentialEvidence,
  verifyAndBindCommanderSubscriptionCredential: runtimeMocks.verifyAndBind,
}));
vi.mock("../utils/terminate-process.js", () => ({
  terminateByPidIfMatches: vi.fn(),
}));

import { buildCommanderLoginService } from "../services/commander-login-runtime.js";

function runtimeDb() {
  const rows = new Map<string, Record<string, unknown>>();
  const tx = {
    execute: vi.fn(async () => undefined),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () =>
              [...rows.values()].filter((row) => row.status === "pending").slice(0, 1),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: async (value: Record<string, unknown>) => {
        rows.set(String(value.id), { ...value });
      },
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            const [entry] = [...rows.entries()];
            if (!entry) return [];
            rows.set(entry[0], { ...entry[1], ...patch });
            return [{ id: entry[0] }];
          },
        }),
      }),
    }),
    delete: () => ({
      where: async () => {
        rows.clear();
      },
    }),
  };
  return {
    rows,
    db: {
      transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx),
      ...tx,
    } as never,
  };
}

describe("Commander login production runtime finalization", () => {
  it("commits fresh credential evidence after CLI exit without browser status polling", async () => {
    let resolveExit!: (code: number | null) => void;
    const exitPromise = new Promise<number | null>((resolve) => {
      resolveExit = resolve;
    });
    runtimeMocks.runCodexLogin.mockReturnValue({
      handle: {
        child: {},
        pid: 321,
        pgid: 321,
        startedAt: new Date(),
        terminate: vi.fn(),
      },
      authHome: "/scoped/openai",
      urlPromise: Promise.resolve("https://chatgpt.com/device"),
      exitPromise,
      submitCode: vi.fn(() => true),
    });
    runtimeMocks.readSafeCredentialEvidence
      .mockResolvedValueOnce("generation-before")
      .mockResolvedValueOnce("generation-after");

    const { db, rows } = runtimeDb();
    const service = buildCommanderLoginService(db);
    await service.startChallenge({
      companyId: "company-1",
      provider: "openai",
      startedByUserId: "user-1",
      executionTargetId: "hetzner-qa",
    });

    resolveExit(0);

    await vi.waitFor(() => {
      expect(runtimeMocks.verifyAndBind).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          companyId: "company-1",
          provider: "openai",
          userId: "user-1",
          executionTargetId: "hetzner-qa",
          expectedEvidence: "generation-after",
        }),
      );
    });
    expect([...rows.values()][0]).toMatchObject({ status: "completed" });
  });
});
