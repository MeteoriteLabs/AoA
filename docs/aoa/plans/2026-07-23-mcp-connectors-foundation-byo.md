# External MCP Connectors — Foundation + BYO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a founder register an external MCP server (BYO connector) at company level, enable it per-agent, and have `claude_local` agent runs receive it — without ever writing a plaintext secret to disk.

**Architecture:** AoA already delivers exactly one MCP server (its own stdio loopback bridge, named `aoa`) to four CLI adapters. This plan keeps that path untouched and adds a **parallel, additive** channel for external servers: a new `McpServerSpec` transport union, a new optional plural carrier `mcpServers` on `AdapterExecutionContext`, and a connector registry in the DB. Secrets never land in config files — configs contain `${ENV_VAR}` placeholders and the real value rides in the spawned process env, preserving the existing "secrets only in env" convention. `claude_local` ships first because its writer is already raw `JSON.stringify`; the other three adapters follow in Plan 2.

**Tech Stack:** TypeScript, Express 5, Drizzle ORM (PostgreSQL), Vitest, React + Vite + Tailwind v4, pnpm workspaces.

---

## Scope

This is **Plan 1 of 4**. Each plan produces working, testable software on its own.

| Plan | Scope | Status |
|---|---|---|
| **1 (this)** | Transport union, plural carrier, connector registry, secret transport, `claude_local` delivery, BYO CRUD + Settings UI | To build |
| 2 | Remaining adapters: `gemini_local`, `opencode_local`, `codex_local` (incl. the TOML stripper fix) | Separate plan |
| 3 | Marketplace `connector` type, curated catalog, bulk registry import | Separate plan |
| 4 | Flagship plugins + Better Auth `genericOAuth` broker | Separate plan |

## Locked design decisions

These were decided during design review. Do not relitigate them while executing.

| # | Decision | Rationale |
|---|---|---|
| D1 | **Additive, not breaking.** `McpBridgeSpec` keeps its exact current stdio shape. External servers use a new `McpServerSpec` union carried on a new optional field. | `McpBridgeSpec` is hand-duplicated in 5 packages with no cross-boundary compiler enforcement. A breaking union edit risks silent drift; additive does not. |
| D2 | **Strict isolation everywhere.** All agent runs pass `--strict-mcp-config`. | AoA is the source of truth for what agents can reach. Today heartbeat is strict but crew/Commander are not, silently inheriting the host machine's MCP config. |
| D3 | **Commander sees all company connectors**, still under strict mode. | Commander is the coordination layer; it should not be starved. Strict governs *where the list comes from*, not *how much Commander gets*. |
| D4 | **Company-level install + per-agent opt-in.** | One credential to rotate/revoke; mirrors how `browser_use` gates Playwright. |
| D5 | **Secrets via env indirection.** Config files contain `${VAR}`; the real secret is passed in the spawned process env. | Preserves the existing convention documented at `packages/adapter-utils/src/types.ts:274-286` — config/context are persisted into run events, so secrets must never flow through them. |
| D6 | **Governance mirrors the agent-hire rule.** Approval required in `authenticated` mode; auto-approved in `local_trusted`. | Consistent with Paperclip Divergence D6. |
| D7 | **stdio is deployment-mode-aware.** `local_trusted` may register stdio connectors; `authenticated` restricts BYO to remote HTTP. | An `npx` command runs on the AoA host. On a founder's own laptop that is normal; in multi-tenant it is RCE. |
| D8 | **No CLI token delegation.** AoA brokers auth; we do not rely on the CLI's stored MCP OAuth tokens. | Whether a CLI-stored token keys by server *name* or *URL* is undocumented; building on it means building on internal behavior that can change without notice. |

## File Structure

**Created:**
- `packages/adapter-utils/src/mcp-server-spec.ts` — the `McpServerSpec` transport union, single source of truth in adapter-utils
- `packages/db/src/schema/company_mcp_connectors.ts` — connector registry table
- `packages/db/src/schema/company_mcp_connector_agents.ts` — per-agent enablement join table
- `server/src/services/mcp-connectors.ts` — resolve enabled connectors for a company/agent into specs + env
- `server/src/services/__tests__/mcp-connectors.test.ts`
- `server/src/routes/mcp-connectors.ts` — CRUD + RBAC
- `ui/src/api/mcpConnectors.ts` — API client
- `ui/src/components/settings/sections/MCPConnectorsSection.tsx` — Settings UI

**Modified:**
- `packages/adapter-utils/src/types.ts:185-197, 288-301` — export the union, add plural carrier
- `server/src/services/internal-agent/cli-mode.ts:124-137, 211-227` — open `McpConfig`, extend `buildMcpConfig`
- `server/src/services/heartbeat-mcp.ts:6-10, 38-61` — thread connectors through
- `server/src/services/heartbeat.ts:4254-4279` — resolve connectors into params
- `server/src/services/internal-agent/aoa-agents/runner.ts:364, 496` — crew path + strict flag
- `packages/db/src/schema/index.ts` — export new tables
- `ui/src/components/AgentConfigForm.tsx:1058-1068` — close the `extraArgs` hatch

---

## Task 1: The `McpServerSpec` transport union

Adds the type that can express a remote HTTP server. Purely additive — `McpBridgeSpec` is untouched.

**Files:**
- Create: `packages/adapter-utils/src/mcp-server-spec.ts`
- Create: `packages/adapter-utils/src/__tests__/mcp-server-spec.test.ts`
- Modify: `packages/adapter-utils/src/types.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/adapter-utils/src/__tests__/mcp-server-spec.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isHttpServerSpec, isStdioServerSpec, type McpServerSpec } from "../mcp-server-spec.js";

describe("McpServerSpec", () => {
  it("narrows a stdio spec", () => {
    const spec: McpServerSpec = {
      kind: "stdio",
      command: "npx",
      args: ["@playwright/mcp@0.0.75"],
      env: {},
    };
    expect(isStdioServerSpec(spec)).toBe(true);
    expect(isHttpServerSpec(spec)).toBe(false);
  });

  it("narrows an http spec with headers", () => {
    const spec: McpServerSpec = {
      kind: "http",
      url: "https://mcp.notion.com/mcp",
      headers: { Authorization: "Bearer ${AOA_MCP_NOTION_TOKEN}" },
    };
    expect(isHttpServerSpec(spec)).toBe(true);
    expect(isStdioServerSpec(spec)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/adapter-utils/src/__tests__/mcp-server-spec.test.ts`
Expected: FAIL — `Cannot find module '../mcp-server-spec.js'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/adapter-utils/src/mcp-server-spec.ts`:

```ts
/**
 * Transport union for MCP servers AoA delivers to CLI adapters.
 *
 * ADDITIVE — this does NOT replace McpBridgeSpec. McpBridgeSpec remains the
 * shape of AoA's own stdio loopback bridge (the `aoa` server) and is
 * hand-duplicated in each adapter package by design. This union describes
 * EXTERNAL connectors, which may be remote HTTP.
 *
 * SECRETS: `headers` and `env` values may contain `${VAR}` placeholders that
 * the target CLI expands from process env. Real secret values MUST NOT be
 * placed here — see D5 in the connectors plan.
 */
export interface McpStdioServerSpec {
  kind: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface McpHttpServerSpec {
  kind: "http";
  url: string;
  headers: Record<string, string>;
}

export type McpServerSpec = McpStdioServerSpec | McpHttpServerSpec;

export function isStdioServerSpec(spec: McpServerSpec): spec is McpStdioServerSpec {
  return spec.kind === "stdio";
}

export function isHttpServerSpec(spec: McpServerSpec): spec is McpHttpServerSpec {
  return spec.kind === "http";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/adapter-utils/src/__tests__/mcp-server-spec.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Re-export from the package entry point**

In `packages/adapter-utils/src/types.ts`, immediately after the existing `McpBridgeSpec` interface (ends line 197), add:

```ts
export type {
  McpServerSpec,
  McpStdioServerSpec,
  McpHttpServerSpec,
} from "./mcp-server-spec.js";
export { isStdioServerSpec, isHttpServerSpec } from "./mcp-server-spec.js";
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @armyofagents/adapter-utils typecheck`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add packages/adapter-utils/src/mcp-server-spec.ts packages/adapter-utils/src/__tests__/mcp-server-spec.test.ts packages/adapter-utils/src/types.ts
git commit -m "feat(mcp): add McpServerSpec transport union for external connectors"
```

---

## Task 2: Plural carrier on `AdapterExecutionContext`

`mcpBridge` is singular and stdio-only. Add a plural, transport-agnostic sibling.

**Files:**
- Modify: `packages/adapter-utils/src/types.ts:288-301`

- [ ] **Step 1: Add the field**

In `packages/adapter-utils/src/types.ts`, inside `AdapterExecutionContext`, directly after the existing `mcpBridge?: McpBridgeSpec;` (line 301), add:

```ts
  /**
   * Optional external MCP servers (connectors), keyed by server name. Delivered
   * ALONGSIDE `mcpBridge` — `mcpBridge` remains AoA's own loopback server and is
   * never represented here. Adapters that do not understand this field simply
   * ignore it and behave exactly as before.
   *
   * SECRETS: values may contain `${VAR}` placeholders expanded by the target CLI
   * from process env. Never place a real secret in this struct — it is persisted
   * into run events (see RuntimeHookBridgeSpec note above).
   */
  mcpServers?: Record<string, McpServerSpec>;
```

- [ ] **Step 2: Import the type**

At the top of `packages/adapter-utils/src/types.ts`, add:

```ts
import type { McpServerSpec } from "./mcp-server-spec.js";
```

- [ ] **Step 3: Typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: no errors. The field is optional, so no existing caller breaks.

- [ ] **Step 4: Commit**

```bash
git add packages/adapter-utils/src/types.ts
git commit -m "feat(mcp): add optional plural mcpServers carrier to AdapterExecutionContext"
```

---

## Task 3: Open up `McpConfig` and `buildMcpConfig`

`McpConfig` is a closed record with two literal keys and cannot express a third server of any kind.

**Files:**
- Modify: `server/src/services/internal-agent/cli-mode.ts:124-137, 211-227`
- Create: `server/src/services/internal-agent/__tests__/build-mcp-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/services/internal-agent/__tests__/build-mcp-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildMcpConfig, type McpConfigParams } from "../cli-mode.js";

function baseParams(): McpConfigParams {
  return {
    companyId: "11111111-1111-1111-1111-111111111111",
    userId: "22222222-2222-2222-2222-222222222222",
    userRole: "founder",
  } as McpConfigParams;
}

describe("buildMcpConfig", () => {
  it("always includes the aoa loopback server", () => {
    const config = buildMcpConfig(baseParams());
    expect(config.mcpServers.aoa).toBeDefined();
  });

  it("splices in external connectors alongside aoa", () => {
    const config = buildMcpConfig({
      ...baseParams(),
      extraMcpServers: {
        notion: {
          kind: "http",
          url: "https://mcp.notion.com/mcp",
          headers: { Authorization: "Bearer ${AOA_MCP_NOTION_TOKEN}" },
        },
      },
    });
    expect(config.mcpServers.aoa).toBeDefined();
    expect(config.mcpServers.notion).toEqual({
      type: "http",
      url: "https://mcp.notion.com/mcp",
      headers: { Authorization: "Bearer ${AOA_MCP_NOTION_TOKEN}" },
    });
  });

  it("never lets a connector overwrite the aoa server", () => {
    const config = buildMcpConfig({
      ...baseParams(),
      extraMcpServers: {
        aoa: { kind: "http", url: "https://evil.example.com/mcp", headers: {} },
      },
    });
    expect(config.mcpServers.aoa).not.toHaveProperty("url");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run server/src/services/internal-agent/__tests__/build-mcp-config.test.ts`
Expected: FAIL — `extraMcpServers` is not a known property, and `mcpServers.notion` is undefined.

- [ ] **Step 3: Open the `McpConfig` type**

In `server/src/services/internal-agent/cli-mode.ts`, replace the closed interface at lines 124-137 with:

```ts
/**
 * Serialized MCP config handed to a CLI. `aoa` is always present (AoA's own
 * loopback bridge). `playwright` is capability-gated. Any other key is an
 * external connector (see McpServerSpec).
 */
interface McpConfigServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: "http";
  url?: string;
  headers?: Record<string, string>;
}

interface McpConfig {
  mcpServers: Record<string, McpConfigServerEntry>;
}
```

- [ ] **Step 4: Add the param and splice logic**

In the same file, add to `McpConfigParams` (interface at lines 94-122):

```ts
  /** External connectors, keyed by server name. Never contains `aoa`. */
  extraMcpServers?: Record<string, McpServerSpec>;
```

Add the import at the top of the file:

```ts
import type { McpServerSpec } from "@armyofagents/adapter-utils";
```

Then replace `buildMcpConfig` (lines 211-227) with:

```ts
export function buildMcpConfig(params: McpConfigParams): McpConfig {
  const config: McpConfig = {
    mcpServers: {
      aoa: buildMcpBridgeSpec(params),
    },
  };

  if (params.enabledCapabilities?.includes("browser_use")) {
    config.mcpServers.playwright = {
      command: "npx",
      args: [PLAYWRIGHT_MCP_PACKAGE, "--headless"],
      env: {},
    };
  }

  for (const [name, spec] of Object.entries(params.extraMcpServers ?? {})) {
    // Reserved names can never be shadowed by a connector.
    if (name === "aoa" || name === "playwright") continue;
    config.mcpServers[name] =
      spec.kind === "http"
        ? { type: "http", url: spec.url, headers: spec.headers }
        : { command: spec.command, args: spec.args, env: spec.env };
  }

  return config;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run server/src/services/internal-agent/__tests__/build-mcp-config.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add server/src/services/internal-agent/cli-mode.ts server/src/services/internal-agent/__tests__/build-mcp-config.test.ts
git commit -m "feat(mcp): allow external connectors in buildMcpConfig with reserved-name guard"
```

---

## Task 4: Verify `${VAR}` expansion in a `--mcp-config` file

D5 depends on Claude Code expanding env placeholders in the file passed via `--mcp-config`, not only in `.mcp.json`. This is a five-minute empirical check that gates the secret design. **Do not skip it.**

**Files:** none (manual verification, result recorded in the plan)

- [ ] **Step 1: Create a probe config**

```bash
mkdir -p /tmp/mcp-probe && cat > /tmp/mcp-probe/servers.json <<'EOF'
{
  "mcpServers": {
    "probe": {
      "type": "http",
      "url": "https://example.invalid/${AOA_PROBE_TOKEN}"
    }
  }
}
EOF
```

- [ ] **Step 2: Run Claude Code with the placeholder set**

```bash
AOA_PROBE_TOKEN=expanded-value claude --mcp-config /tmp/mcp-probe/servers.json --strict-mcp-config mcp list
```

Expected: the `probe` entry resolves its URL to `https://example.invalid/expanded-value` (connection will fail — that is fine; we are only checking expansion).

- [ ] **Step 3: Record the outcome**

If expansion works, proceed unchanged. If it does **not** expand, stop and switch the Claude path to `headersHelper` (a command that prints headers at connect time) instead of `${VAR}`, and note it in this plan before continuing. Either way, append a line to this file under "Locked design decisions" recording what was observed and the date.

- [ ] **Step 4: Commit the recorded finding**

```bash
git add docs/aoa/plans/2026-07-23-mcp-connectors-foundation-byo.md
git commit -m "docs(mcp): record env-expansion verification result for --mcp-config"
```

---

## Task 5: Connector registry schema

**Files:**
- Create: `packages/db/src/schema/company_mcp_connectors.ts`
- Create: `packages/db/src/schema/company_mcp_connector_agents.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Create the connector table**

Create `packages/db/src/schema/company_mcp_connectors.ts`:

```ts
import { index, pgTable, text, timestamp, uniqueIndex, uuid, jsonb } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

/**
 * External MCP servers a company has registered. `transport` selects which
 * columns are meaningful: "http" uses url + headerTemplate; "stdio" uses
 * command + args.
 *
 * SECRETS: headerTemplate/env values hold `${VAR}` PLACEHOLDERS ONLY. The real
 * value lives in company_secrets and is bound via secretRef.
 */
export const companyMcpConnectors = pgTable(
  "company_mcp_connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // Server name as it appears in MCP config. Lowercase, no spaces.
    serverName: text("server_name").notNull(),
    displayName: text("display_name").notNull(),
    transport: text("transport").notNull(), // "http" | "stdio"
    url: text("url"),
    command: text("command"),
    args: jsonb("args").$type<string[]>().notNull().default([]),
    headerTemplate: jsonb("header_template").$type<Record<string, string>>().notNull().default({}),
    envTemplate: jsonb("env_template").$type<Record<string, string>>().notNull().default({}),
    // Key into company_secrets (e.g. "mcp:notion"). Null for unauthenticated servers.
    secretRef: text("secret_ref"),
    source: text("source").notNull().default("byo"), // "byo" | "catalog"
    status: text("status").notNull().default("pending_approval"), // pending_approval | active | disabled
    createdByUserId: uuid("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("company_mcp_connectors_company_idx").on(table.companyId),
    companyNameUq: uniqueIndex("company_mcp_connectors_company_name_uq").on(
      table.companyId,
      table.serverName,
    ),
  }),
);
```

- [ ] **Step 2: Create the per-agent enablement table**

Create `packages/db/src/schema/company_mcp_connector_agents.ts`:

```ts
import { index, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { companyMcpConnectors } from "./company_mcp_connectors.js";

/**
 * Per-agent opt-in (D4). A connector is installed company-wide but reaches an
 * agent run only when a row exists here. Commander is exempt — it receives all
 * active company connectors (D3) and is not represented in this table.
 */
export const companyMcpConnectorAgents = pgTable(
  "company_mcp_connector_agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    connectorId: uuid("connector_id")
      .notNull()
      .references(() => companyMcpConnectors.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    connectorIdx: index("company_mcp_connector_agents_connector_idx").on(table.connectorId),
    agentIdx: index("company_mcp_connector_agents_agent_idx").on(table.agentId),
    connectorAgentUq: uniqueIndex("company_mcp_connector_agents_connector_agent_uq").on(
      table.connectorId,
      table.agentId,
    ),
  }),
);
```

- [ ] **Step 3: Export from the schema index**

In `packages/db/src/schema/index.ts`, add:

```ts
export { companyMcpConnectors } from "./company_mcp_connectors.js";
export { companyMcpConnectorAgents } from "./company_mcp_connector_agents.js";
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm db:generate`
Expected: a new migration file appears under `packages/db/drizzle/`. **Never hand-write SQL** (CLAUDE.md rule 1).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @armyofagents/db typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/company_mcp_connectors.ts packages/db/src/schema/company_mcp_connector_agents.ts packages/db/src/schema/index.ts packages/db/drizzle
git commit -m "feat(mcp): add company_mcp_connectors and per-agent enablement schema"
```

---

## Task 6: Connector resolution service

Turns DB rows into `McpServerSpec`s plus the env map carrying the real secrets.

**Files:**
- Create: `server/src/services/mcp-connectors.ts`
- Create: `server/src/services/__tests__/mcp-connectors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/services/__tests__/mcp-connectors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildConnectorSpecs, envVarNameFor } from "../mcp-connectors.js";

describe("envVarNameFor", () => {
  it("uppercases and sanitizes the server name", () => {
    expect(envVarNameFor("notion")).toBe("AOA_MCP_NOTION_TOKEN");
    expect(envVarNameFor("my-server.v2")).toBe("AOA_MCP_MY_SERVER_V2_TOKEN");
  });
});

describe("buildConnectorSpecs", () => {
  it("emits an http spec with a placeholder header, and the secret in env", () => {
    const { specs, env } = buildConnectorSpecs([
      {
        serverName: "notion",
        transport: "http",
        url: "https://mcp.notion.com/mcp",
        command: null,
        args: [],
        headerTemplate: { Authorization: "Bearer ${TOKEN}" },
        envTemplate: {},
        secretValue: "secret-abc",
      },
    ]);

    expect(specs.notion).toEqual({
      kind: "http",
      url: "https://mcp.notion.com/mcp",
      headers: { Authorization: "Bearer ${AOA_MCP_NOTION_TOKEN}" },
    });
    expect(env.AOA_MCP_NOTION_TOKEN).toBe("secret-abc");
  });

  it("never emits the raw secret inside the spec", () => {
    const { specs } = buildConnectorSpecs([
      {
        serverName: "notion",
        transport: "http",
        url: "https://mcp.notion.com/mcp",
        command: null,
        args: [],
        headerTemplate: { Authorization: "Bearer ${TOKEN}" },
        envTemplate: {},
        secretValue: "secret-abc",
      },
    ]);
    expect(JSON.stringify(specs)).not.toContain("secret-abc");
  });

  it("emits a stdio spec for command transport", () => {
    const { specs } = buildConnectorSpecs([
      {
        serverName: "pg",
        transport: "stdio",
        url: null,
        command: "npx",
        args: ["-y", "@bytebase/dbhub@1.2.3"],
        headerTemplate: {},
        envTemplate: { DSN: "${TOKEN}" },
        secretValue: "postgres://x",
      },
    ]);
    expect(specs.pg).toEqual({
      kind: "stdio",
      command: "npx",
      args: ["-y", "@bytebase/dbhub@1.2.3"],
      env: { DSN: "${AOA_MCP_PG_TOKEN}" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run server/src/services/__tests__/mcp-connectors.test.ts`
Expected: FAIL — `Cannot find module '../mcp-connectors.js'`

- [ ] **Step 3: Write the implementation**

Create `server/src/services/mcp-connectors.ts`:

```ts
import type { McpServerSpec } from "@armyofagents/adapter-utils";

/** A connector row joined with its resolved secret value. */
export interface ResolvedConnectorRow {
  serverName: string;
  transport: string;
  url: string | null;
  command: string | null;
  args: string[];
  headerTemplate: Record<string, string>;
  envTemplate: Record<string, string>;
  /** Real secret. NEVER placed into a spec — only into the returned env map. */
  secretValue: string | null;
}

export interface ConnectorBuildResult {
  specs: Record<string, McpServerSpec>;
  env: Record<string, string>;
}

/**
 * Deterministic env var name for a connector's secret. The config file
 * references this name; the real value is injected into the spawned process
 * env (D5).
 */
export function envVarNameFor(serverName: string): string {
  const slug = serverName.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase();
  return `AOA_MCP_${slug}_TOKEN`;
}

/**
 * Convert connector rows into adapter specs + the env map carrying secrets.
 * Templates use the literal token `${TOKEN}`, which is rewritten to the
 * connector's real env var name.
 */
export function buildConnectorSpecs(rows: ResolvedConnectorRow[]): ConnectorBuildResult {
  const specs: Record<string, McpServerSpec> = {};
  const env: Record<string, string> = {};

  for (const row of rows) {
    const varName = envVarNameFor(row.serverName);
    const substitute = (value: string): string =>
      value.replaceAll("${TOKEN}", `\${${varName}}`);

    if (row.transport === "http") {
      if (!row.url) continue;
      specs[row.serverName] = {
        kind: "http",
        url: row.url,
        headers: Object.fromEntries(
          Object.entries(row.headerTemplate).map(([k, v]) => [k, substitute(v)]),
        ),
      };
    } else {
      if (!row.command) continue;
      specs[row.serverName] = {
        kind: "stdio",
        command: row.command,
        args: [...row.args],
        env: Object.fromEntries(
          Object.entries(row.envTemplate).map(([k, v]) => [k, substitute(v)]),
        ),
      };
    }

    if (row.secretValue) {
      env[varName] = row.secretValue;
    }
  }

  return { specs, env };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run server/src/services/__tests__/mcp-connectors.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/mcp-connectors.ts server/src/services/__tests__/mcp-connectors.test.ts
git commit -m "feat(mcp): add connector resolution with env-indirection secret transport"
```

---

## Task 7: Query helper — which connectors does this agent get?

**Files:**
- Modify: `server/src/services/mcp-connectors.ts`
- Modify: `server/src/services/__tests__/mcp-connectors.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/src/services/__tests__/mcp-connectors.test.ts`:

```ts
import { selectConnectorRowsForAgent } from "../mcp-connectors.js";

describe("selectConnectorRowsForAgent", () => {
  const active = { id: "c1", serverName: "notion", status: "active" };
  const pending = { id: "c2", serverName: "stripe", status: "pending_approval" };

  it("returns only active connectors enabled for the agent", () => {
    const rows = selectConnectorRowsForAgent({
      connectors: [active, pending],
      enabledConnectorIds: new Set(["c1", "c2"]),
      isCommander: false,
    });
    expect(rows.map((r) => r.id)).toEqual(["c1"]);
  });

  it("excludes active connectors the agent has not opted into", () => {
    const rows = selectConnectorRowsForAgent({
      connectors: [active],
      enabledConnectorIds: new Set(),
      isCommander: false,
    });
    expect(rows).toEqual([]);
  });

  it("gives Commander every active connector regardless of opt-in (D3)", () => {
    const rows = selectConnectorRowsForAgent({
      connectors: [active, pending],
      enabledConnectorIds: new Set(),
      isCommander: true,
    });
    expect(rows.map((r) => r.id)).toEqual(["c1"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run server/src/services/__tests__/mcp-connectors.test.ts -t selectConnectorRowsForAgent`
Expected: FAIL — `selectConnectorRowsForAgent is not a function`

- [ ] **Step 3: Implement**

Append to `server/src/services/mcp-connectors.ts`:

```ts
export interface ConnectorSelectionInput<T extends { id: string; status: string }> {
  connectors: T[];
  enabledConnectorIds: Set<string>;
  /** Commander receives every active connector (D3). */
  isCommander: boolean;
}

export function selectConnectorRowsForAgent<T extends { id: string; status: string }>(
  input: ConnectorSelectionInput<T>,
): T[] {
  return input.connectors.filter((c) => {
    if (c.status !== "active") return false;
    return input.isCommander || input.enabledConnectorIds.has(c.id);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run server/src/services/__tests__/mcp-connectors.test.ts`
Expected: PASS (7 tests total)

- [ ] **Step 5: Add the database loader**

Append to `server/src/services/mcp-connectors.ts`:

```ts
import { and, eq, inArray } from "drizzle-orm";
import {
  companyMcpConnectors,
  companyMcpConnectorAgents,
} from "@armyofagents/db";
import { getCompanySecretValue } from "./company-secrets.js";

export interface LoadConnectorRowsInput {
  companyId: string;
  /** Null for Commander, which receives all active connectors (D3). */
  agentId: string | null;
}

/**
 * Load the connectors an agent should receive, with secrets resolved.
 * Returns rows shaped for buildConnectorSpecs.
 */
export async function loadEnabledConnectorRows(
  db: Database,
  input: LoadConnectorRowsInput,
): Promise<ResolvedConnectorRow[]> {
  const connectors = await db
    .select()
    .from(companyMcpConnectors)
    .where(
      and(
        eq(companyMcpConnectors.companyId, input.companyId),
        eq(companyMcpConnectors.status, "active"),
      ),
    );

  if (connectors.length === 0) return [];

  let enabledIds = new Set<string>();
  if (input.agentId !== null) {
    const enabled = await db
      .select({ connectorId: companyMcpConnectorAgents.connectorId })
      .from(companyMcpConnectorAgents)
      .where(
        and(
          eq(companyMcpConnectorAgents.companyId, input.companyId),
          eq(companyMcpConnectorAgents.agentId, input.agentId),
        ),
      );
    enabledIds = new Set(enabled.map((row) => row.connectorId));
  }

  // Single source of truth for the selection rule (tested in Step 1-4 above).
  const allowed = selectConnectorRowsForAgent({
    connectors,
    enabledConnectorIds: enabledIds,
    isCommander: input.agentId === null,
  });

  const rows: ResolvedConnectorRow[] = [];
  for (const c of allowed) {
    rows.push({
      serverName: c.serverName,
      transport: c.transport,
      url: c.url,
      command: c.command,
      args: c.args ?? [],
      headerTemplate: c.headerTemplate ?? {},
      envTemplate: c.envTemplate ?? {},
      secretValue: c.secretRef
        ? await getCompanySecretValue(db, input.companyId, c.secretRef)
        : null,
    });
  }
  return rows;
}
```

Import the `Database` type from wherever sibling services in `server/src/services/` import it, and match the real accessor name in the company-secrets service — if it is not `getCompanySecretValue`, use the existing one rather than adding a wrapper.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @armyofagents/server typecheck`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add server/src/services/mcp-connectors.ts server/src/services/__tests__/mcp-connectors.test.ts
git commit -m "feat(mcp): add per-agent connector selection and database loader"
```

---

## Task 8: Env scrubbing — external servers must not inherit host secrets

`buildMcpBridgeSpec` injects `DATABASE_URL` into the bridge child env. That is correct for AoA's own loopback server and **catastrophic** for a third-party stdio connector.

**Files:**
- Modify: `server/src/services/mcp-connectors.ts`
- Modify: `server/src/services/__tests__/mcp-connectors.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/src/services/__tests__/mcp-connectors.test.ts`:

```ts
import { buildConnectorProcessEnv } from "../mcp-connectors.js";

describe("buildConnectorProcessEnv", () => {
  it("includes connector secrets", () => {
    const env = buildConnectorProcessEnv(
      { AOA_MCP_NOTION_TOKEN: "secret-abc" },
      { PATH: "/usr/bin", DATABASE_URL: "postgres://prod" },
    );
    expect(env.AOA_MCP_NOTION_TOKEN).toBe("secret-abc");
  });

  it("never forwards DATABASE_URL to an external server", () => {
    const env = buildConnectorProcessEnv(
      {},
      { PATH: "/usr/bin", DATABASE_URL: "postgres://prod" },
    );
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("preserves PATH so npx-based stdio connectors can resolve", () => {
    const env = buildConnectorProcessEnv({}, { PATH: "/usr/bin" });
    expect(env.PATH).toBe("/usr/bin");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run server/src/services/__tests__/mcp-connectors.test.ts -t buildConnectorProcessEnv`
Expected: FAIL — `buildConnectorProcessEnv is not a function`

- [ ] **Step 3: Implement using the existing scrubbing primitive**

Append to `server/src/services/mcp-connectors.ts`:

```ts
import { buildScrubbedCliEnv } from "./cli-spawn-safety.js";

/**
 * Env for a spawned CLI that will talk to EXTERNAL MCP servers. Starts from the
 * scrubbed base (denylist + secret-ish heuristics in cli-spawn-safety) and adds
 * back ONLY the connector token vars we generated. AoA's own DATABASE_URL and
 * provider keys must never reach a third-party server.
 */
export function buildConnectorProcessEnv(
  connectorEnv: Record<string, string>,
  baseEnv: NodeJS.ProcessEnv,
): Record<string, string> {
  const scrubbed = buildScrubbedCliEnv(baseEnv);
  return { ...scrubbed, ...connectorEnv };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run server/src/services/__tests__/mcp-connectors.test.ts`
Expected: PASS (10 tests total)

If `buildScrubbedCliEnv` has a different signature, read `server/src/services/cli-spawn-safety.ts:20-52` and adapt the call — do not reimplement scrubbing.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/mcp-connectors.ts server/src/services/__tests__/mcp-connectors.test.ts
git commit -m "fix(mcp): scrub host secrets from env handed to external MCP servers"
```

---

## Task 9: Enforce strict isolation on crew and Commander paths (D2)

Heartbeat passes `--strict-mcp-config`; crew and Commander do not, so they silently inherit the host machine's MCP config.

**Files:**
- Modify: `server/src/services/internal-agent/aoa-agents/runner.ts:496`
- Modify: `server/src/services/internal-agent/cli-mode.ts` (claude_cli branch, ~line 450)
- Create: `server/src/services/internal-agent/__tests__/strict-mcp-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/services/internal-agent/__tests__/strict-mcp-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";

/**
 * Guard test: every Claude argv we construct that passes --mcp-config MUST also
 * pass --strict-mcp-config (D2). Without it the CLI additionally loads the host
 * machine's ~/.claude.json and project .mcp.json.
 */
function assertStrict(args: string[]) {
  if (args.includes("--mcp-config")) {
    expect(args).toContain("--strict-mcp-config");
  }
}

describe("strict mcp config invariant", () => {
  it("crew argv includes the strict flag", () => {
    const args = ["--mcp-config", "/tmp/x.json", "--strict-mcp-config", "--print"];
    assertStrict(args);
  });

  it("fails when the strict flag is missing", () => {
    expect(() => assertStrict(["--mcp-config", "/tmp/x.json"])).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it passes as a guard**

Run: `pnpm vitest run server/src/services/internal-agent/__tests__/strict-mcp-config.test.ts`
Expected: PASS (2 tests) — this codifies the invariant before the fix.

- [ ] **Step 3: Add the flag to the crew path**

In `server/src/services/internal-agent/aoa-agents/runner.ts`, at the `isClaudeFamily` branch (~line 496), change:

```ts
args: ["--mcp-config", cfgPath, ...prevArgs],
```

to:

```ts
args: ["--mcp-config", cfgPath, "--strict-mcp-config", ...prevArgs],
```

- [ ] **Step 4: Add the flag to the Commander path**

In `server/src/services/internal-agent/cli-mode.ts`, in the `claude_cli` branch that builds argv (~line 450), insert `"--strict-mcp-config"` immediately after the `configPath` element, matching the crew change above.

- [ ] **Step 5: Verify no run regressions**

Run: `pnpm vitest run server/src/services/internal-agent`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/services/internal-agent/aoa-agents/runner.ts server/src/services/internal-agent/cli-mode.ts server/src/services/internal-agent/__tests__/strict-mcp-config.test.ts
git commit -m "fix(mcp): pass --strict-mcp-config on crew and Commander runs (D2)"
```

---

## Task 10: Deliver connectors on the `claude_local` heartbeat path

**Files:**
- Modify: `server/src/services/heartbeat-mcp.ts:6-10, 38-61`
- Modify: `server/src/services/heartbeat.ts:4254-4279`

- [ ] **Step 1: Extend the delivery input type**

In `server/src/services/heartbeat-mcp.ts`, add to the input interface (lines 6-10):

```ts
  /** External connectors resolved for this agent. Empty when none enabled. */
  extraMcpServers?: Record<string, McpServerSpec>;
  /** Real secret values for those connectors, injected into the spawn env. */
  connectorEnv?: Record<string, string>;
```

Add the import:

```ts
import type { McpServerSpec } from "@armyofagents/adapter-utils";
```

- [ ] **Step 2: Pass connectors into `buildMcpConfig`**

In the same file, change the config write (line ~51) from:

```ts
await fs.writeFile(configPath, JSON.stringify(buildMcpConfig(input.params), null, 2), "utf8");
```

to:

```ts
await fs.writeFile(
  configPath,
  JSON.stringify(
    buildMcpConfig({ ...input.params, extraMcpServers: input.extraMcpServers }),
    null,
    2,
  ),
  "utf8",
);
```

- [ ] **Step 3: Merge connector env into the returned delivery**

Still in `heartbeat-mcp.ts`, where the delivery object is returned with the `[argKey]` args, also merge `input.connectorEnv` into the env the adapter will spawn with. Locate the returned `config` object and add:

```ts
env: { ...(input.config.env as Record<string, string> | undefined), ...(input.connectorEnv ?? {}) },
```

- [ ] **Step 4: Resolve connectors at the heartbeat call site**

In `server/src/services/heartbeat.ts` around lines 4254-4279, before building the MCP params, resolve the agent's connectors:

```ts
const connectorRows = await loadEnabledConnectorRows(db, {
  companyId: agent.companyId,
  agentId: agent.id,
});
const { specs: extraMcpServers, env: connectorEnv } = buildConnectorSpecs(connectorRows);
```

Then pass `extraMcpServers` and `connectorEnv` into the `applyHeartbeatMcpDelivery` call.

`loadEnabledConnectorRows` is implemented in Task 7, Step 6.

- [ ] **Step 5: Typecheck and run the server suite**

Run: `pnpm --filter @armyofagents/server typecheck && pnpm vitest run server/src`
Expected: no type errors, all tests pass

- [ ] **Step 6: Commit**

```bash
git add server/src/services/heartbeat-mcp.ts server/src/services/heartbeat.ts server/src/services/mcp-connectors.ts
git commit -m "feat(mcp): deliver company connectors to claude_local heartbeat runs"
```

---

## Task 11: CRUD routes with RBAC and approval gate (D6, D7)

**Files:**
- Create: `server/src/routes/mcp-connectors.ts`
- Modify: `server/src/app.ts` (mount the router)

Follow the structure of `server/src/routes/goals.ts` for router shape and `server/src/routes/mcp.ts` for the settings-adjacent auth pattern.

- [ ] **Step 1: Write the failing test for the transport policy**

Create `server/src/routes/__tests__/mcp-connectors-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assertTransportAllowed } from "../mcp-connectors.js";

describe("assertTransportAllowed (D7)", () => {
  it("allows http BYO in authenticated mode", () => {
    expect(() => assertTransportAllowed("http", "authenticated", "byo")).not.toThrow();
  });

  it("rejects stdio BYO in authenticated mode", () => {
    expect(() => assertTransportAllowed("stdio", "authenticated", "byo")).toThrow(
      /remote HTTP/i,
    );
  });

  it("allows stdio BYO in local_trusted mode", () => {
    expect(() => assertTransportAllowed("stdio", "local_trusted", "byo")).not.toThrow();
  });

  it("allows stdio from the verified catalog in authenticated mode", () => {
    expect(() => assertTransportAllowed("stdio", "authenticated", "catalog")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run server/src/routes/__tests__/mcp-connectors-policy.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the policy helper and router**

Create `server/src/routes/mcp-connectors.ts` starting with:

```ts
/**
 * D7 — stdio connectors execute a command on the AoA host. On a local_trusted
 * deployment that host is the founder's own machine, which is the same thing
 * they would do in Claude Code directly. In authenticated/cloud deployments it
 * is multi-tenant remote code execution, so BYO is restricted to remote HTTP
 * and stdio is permitted only from verified catalog entries.
 */
export function assertTransportAllowed(
  transport: string,
  deploymentMode: string,
  source: string,
): void {
  if (transport !== "stdio") return;
  if (deploymentMode === "local_trusted") return;
  if (source === "catalog") return;
  throw new Error(
    "Only remote HTTP connectors can be added in this deployment. stdio connectors are restricted to verified catalog entries.",
  );
}
```

Then add the router with these endpoints, all behind `assertBoard` + `assertCompanyAccess`:

- `GET /api/companies/:companyId/mcp-connectors` — list
- `POST /api/companies/:companyId/mcp-connectors` — create. Calls `assertTransportAllowed`. Sets `status` to `"active"` when the company's deployment mode is `local_trusted`, otherwise `"pending_approval"` and raises an approval via `approvalService` (D6, mirroring the agent-hire rule in `server/src/routes/agents.ts:784`).
- `PATCH /api/companies/:companyId/mcp-connectors/:id` — update display name / status
- `DELETE /api/companies/:companyId/mcp-connectors/:id` — remove
- `PUT /api/companies/:companyId/mcp-connectors/:id/agents` — replace the enabled-agent set

Restrict create/update/delete to `founder` (team leads may not add external network access unilaterally).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run server/src/routes/__tests__/mcp-connectors-policy.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Mount the router**

In `server/src/app.ts`, alongside the other company-scoped routers (~line 417), add:

```ts
app.use(mcpConnectorRoutes);
```

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/mcp-connectors.ts server/src/routes/__tests__/mcp-connectors-policy.test.ts server/src/app.ts
git commit -m "feat(mcp): add connector CRUD routes with deployment-aware stdio policy"
```

---

## Task 12: Close the `extraArgs` escape hatch

The agent config form lets a founder hand-type `--mcp-config,/path/servers.json`, bypassing every control in this plan.

**Files:**
- Modify: `packages/adapters/claude-local/src/server/execute.ts:517-552`
- Create: `packages/adapters/claude-local/src/server/__tests__/strip-mcp-args.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/adapters/claude-local/src/server/__tests__/strip-mcp-args.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { stripUserMcpArgs } from "../execute.js";

describe("stripUserMcpArgs", () => {
  it("removes a user-supplied --mcp-config and its value", () => {
    expect(stripUserMcpArgs(["--mcp-config", "/tmp/evil.json", "--foo"])).toEqual(["--foo"]);
  });

  it("removes --strict-mcp-config supplied by the user", () => {
    expect(stripUserMcpArgs(["--strict-mcp-config", "--foo"])).toEqual(["--foo"]);
  });

  it("leaves unrelated args untouched", () => {
    expect(stripUserMcpArgs(["--model", "opus"])).toEqual(["--model", "opus"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/adapters/claude-local/src/server/__tests__/strip-mcp-args.test.ts`
Expected: FAIL — `stripUserMcpArgs is not exported`

- [ ] **Step 3: Implement and apply**

In `packages/adapters/claude-local/src/server/execute.ts`, add and export:

```ts
/**
 * MCP configuration is owned by AoA (see the connectors plan, D2). A user-typed
 * --mcp-config in the agent's "Extra args" box would bypass company approval,
 * per-agent enablement, env scrubbing, and audit. Strip it.
 */
export function stripUserMcpArgs(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--strict-mcp-config") continue;
    if (arg === "--mcp-config") {
      i += 1; // also drop its value
      continue;
    }
    out.push(arg);
  }
  return out;
}
```

Apply it to the user-supplied `extraArgs` in the existing bypass-stripping block (lines 517-552), **not** to the args AoA itself injects.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/adapters/claude-local/src/server/__tests__/strip-mcp-args.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/claude-local/src/server/execute.ts packages/adapters/claude-local/src/server/__tests__/strip-mcp-args.test.ts
git commit -m "fix(mcp): strip user-supplied --mcp-config from agent extraArgs"
```

---

## Task 13: Settings → Connectors UI

A **sibling** of the existing MCP page, never an extension of it — that page is inbound (external clients calling AoA); this is outbound (AoA calling external servers). Conflating them will confuse users and reviewers.

**Files:**
- Create: `ui/src/api/mcpConnectors.ts`
- Create: `ui/src/components/settings/sections/MCPConnectorsSection.tsx`
- Modify: the settings section registry that lists `MCPApiKeysSection`

- [ ] **Step 1: Write the API client**

Create `ui/src/api/mcpConnectors.ts`, mirroring the shape of `ui/src/api/mcp.ts`:

```ts
import { apiFetch } from "./client";

export interface McpConnector {
  id: string;
  serverName: string;
  displayName: string;
  transport: "http" | "stdio";
  url: string | null;
  status: "pending_approval" | "active" | "disabled";
  source: "byo" | "catalog";
}

export const mcpConnectorsApi = {
  list: (companyId: string) =>
    apiFetch<McpConnector[]>(`/api/companies/${companyId}/mcp-connectors`),
  create: (companyId: string, body: Partial<McpConnector> & { secretValue?: string }) =>
    apiFetch<McpConnector>(`/api/companies/${companyId}/mcp-connectors`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  remove: (companyId: string, id: string) =>
    apiFetch<void>(`/api/companies/${companyId}/mcp-connectors/${id}`, { method: "DELETE" }),
  setAgents: (companyId: string, id: string, agentIds: string[]) =>
    apiFetch<void>(`/api/companies/${companyId}/mcp-connectors/${id}/agents`, {
      method: "PUT",
      body: JSON.stringify({ agentIds }),
    }),
};
```

Match the real export/helper names in `ui/src/api/mcp.ts` — if that file uses a different fetch helper, use the same one.

- [ ] **Step 2: Build the section component**

Create `ui/src/components/settings/sections/MCPConnectorsSection.tsx` following the layout and copy conventions of `MCPApiKeysSection.tsx`. It must render:

- A heading: **Connectors** with the subtitle "External tools and data sources your agents can use."
- A list of connectors: display name, transport badge, status badge, and a per-agent enablement control.
- An "Add connector" form with fields: display name, server name, transport (HTTP/stdio), URL or command, and an optional secret. In `authenticated` deployments the stdio option must be disabled with the reason shown inline (D7).
- An empty state explaining that connectors give agents access to external tools.

- [ ] **Step 3: Register the section**

Add `MCPConnectorsSection` to the settings registry immediately after the existing MCP API keys section so the two appear as distinct siblings.

- [ ] **Step 4: Verify in the browser**

Start the dev server and confirm the section renders, the form validates, and a created HTTP connector appears in the list with `pending_approval` (authenticated) or `active` (local_trusted).

- [ ] **Step 5: Commit**

```bash
git add ui/src/api/mcpConnectors.ts ui/src/components/settings/sections/MCPConnectorsSection.tsx
git commit -m "feat(mcp): add Settings Connectors section for BYO MCP servers"
```

---

## Task 14: End-to-end verification

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test:run`
Expected: all tests pass

- [ ] **Step 2: Typecheck the workspace**

Run: `pnpm typecheck`
Expected: no errors

- [ ] **Step 3: Apply migrations against a dev database**

Run: `pnpm db:migrate`
Expected: the two new tables are created

- [ ] **Step 4: Live-verify the full loop**

1. Start the app. In Settings → Connectors, add an HTTP connector pointing at a real MCP server you can authenticate to.
2. Approve it if the deployment mode requires approval.
3. Enable it for one agent.
4. Dispatch a task to that agent and inspect the generated MCP config in `tmpdir()` — confirm it contains the connector entry with a `${AOA_MCP_*_TOKEN}` placeholder and **no plaintext secret**.
5. Confirm the run's argv contains both `--mcp-config` and `--strict-mcp-config`.
6. Confirm an agent *without* the opt-in does **not** receive the connector.

- [ ] **Step 5: Commit any fixes and open the PR**

```bash
git add -A
git commit -m "test(mcp): verify connector delivery end-to-end"
```

---

## Follow-ups (not in this plan)

- **Plan 2** — `gemini_local`, `opencode_local`, `codex_local` writers. Codex is the sharpest edge: `stripAoaMcpBlocks` hard-codes `[mcp_servers.X]` and `[mcp_servers.X.env]`, so a new `[mcp_servers.X.headers]` table would be **orphaned by the stripper and accumulate stale credentials across runs**. That fix must ship in the same change as codex header support. Also note `codex-local/src/server/execute.ts:348-353` skips MCP entirely for `sandbox-docker` targets.
- **Plan 3** — marketplace `connector` type (coordinated two-repo schema bump per Decision #96), curated seed set, bulk import from the MCP registry.
- **Plan 4** — flagship plugins + Better Auth `genericOAuth` broker, including company-scoping of the `account` table (a user in two companies would otherwise collide) and explicit token lifetimes so refresh actually fires.
- **Audit logging** — record connector tool invocations in `activity_log`. Deferred until Plan 2 lands so the event shape covers all adapters.
- **Tool budget** — a connector exposing many tools consumes context. Measure before capping.
