import { Router } from "express";
import { z } from "zod";
import type { Db } from "@armyofagents/db";
import type { McpConnectorCatalogEntry } from "@armyofagents/shared";
import { validate } from "../middleware/validate.js";
import { logger } from "../middleware/logger.js";
import {
  approvalService,
  logActivity,
  mcpConnectorService,
  secretService,
} from "../services/index.js";
import { badRequest, conflict, forbidden } from "../errors.js";
import {
  resolveConnectorCatalogService,
  type ConnectorCatalogService,
} from "../services/mcp-connector-catalog.js";
import {
  CONSENT_TOKEN_TTL_MS,
  mintConsentToken,
  resolveConsentSecret,
  verifyConsentToken,
} from "../services/mcp-connector-consent.js";
import {
  createConnector,
  type CreateConnectorInput,
} from "../services/mcp-connector-create.js";
import { resolveConnectorStatus } from "../services/mcp-connector-status.js";
import { assertTransportAllowed } from "../services/mcp-connector-transport-gate.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { assertRole } from "../middleware/rbac.js";
import { loadConfig } from "../config.js";

/**
 * Founder-facing CRUD for external MCP connectors. This is the WRITE PATH —
 * the first point where untrusted founder input enters the connector system —
 * so the validation below is load-bearing for security properties proven in
 * earlier tasks, NOT hygiene:
 *
 *  - serverName charset `/^[a-z0-9-]+$/` (A21): `envVarNameFor` maps every
 *    non-alphanumeric char to `_` and uppercases, so permitting `_` or
 *    uppercase would make that mapping non-injective and let two connectors
 *    collide on ONE secret env var — the wrong credential reaching the wrong
 *    server. The charset also structurally excludes `__proto__` (has `_`).
 *  - transport/url/command coherence (A20).
 *  - args/headerTemplate/envTemplate structural shape (A26): the runtime
 *    `buildConnectorSpecs` only guarantees "won't throw", not "well-formed".
 *
 * The DB deliberately enforces none of these (a CHECK on transport would be an
 * enum in disguise, A2), so THIS route is the single enforcement point for the
 * SHAPE of founder input.
 *
 * WHAT IS NOT HERE (I2): everything downstream of shape — the
 * (companyId, serverName) 409, the secretRef-existence check (A19/A20), status
 * derivation, the `install_mcp_connector` approval, and the activity log — lives
 * in the shared `createConnector` service (services/mcp-connector-create.ts).
 * That extraction is deliberate: the catalog install route creates connectors
 * too, and a second inline copy of that governance would drift, with the
 * marketplace copy being the untested one.
 *
 * GOVERNANCE (close the stdio→host-exec chain on a multi-tenant host):
 *  - D7/C1 (`assertTransportAllowed`, services/mcp-connector-transport-gate.ts):
 *    a `stdio` connector runs a command on the AoA host, so it is refused in
 *    `authenticated` mode for founder (BYO) input.
 *  - C2 (PATCH, governance axis): in `authenticated` mode PATCH may only set
 *    status to "disabled" — activation must flow through connector approval,
 *    never PATCH (which would otherwise be a one- or two-hop activation bypass).
 *  - FU-15 (PATCH, credential axis): in EVERY mode, PATCH refuses "active" while
 *    the connector requires a secret it does not have. `local_trusted`'s PATCH
 *    freedom is a decision about governance only; an uncredentialed connector
 *    cannot authenticate regardless of who flipped it.
 *  - C3: client-supplied `source` is stripped; every connector created here is
 *    forced to "byo", so the D7 catalog exemption is unreachable from this route.
 *  - C3 (POST …/:id/credentials): binding a secret re-derives the status through
 *    `resolveConnectorStatus` instead of accepting one. It cannot activate a
 *    connector still awaiting approval and cannot resurrect a disabled one, so it
 *    is not a second activation surface.
 *
 * RBAC (A20/D6): create/update/delete/agent-assignment are founder-only — team
 * leads may not add external network access unilaterally. List is any board
 * member.
 */

// LOAD-BEARING: lowercase letters, digits, hyphen only. Do not widen.
const SERVER_NAME_RE = /^[a-z0-9-]+$/;

// FU-20 — a template VALUE may only be EMPTY or REFERENCE a secret through a
// `${...}` placeholder; a literal credential is refused at the door.
//
// Why this is security, not hygiene: `header_template` / `env_template` are plain
// jsonb columns, NOT the encrypted `company_secrets` store. A real token pasted
// here is persisted verbatim, written verbatim into the agent's on-disk CLI config
// (a git repo the agent can commit and push), returned in full by the board-wide
// list route, and echoed by the error handler on any 5xx. The D5 model is: config
// holds a placeholder, the credential lives in `company_secrets` and rides in the
// process env. `${TOKEN}` is the placeholder `buildConnectorSpecs` rewrites to the
// connector's real env var; `${...}` more generally is a reference, never a literal.
//
// This lives on `templateRecord`, so it covers EVERY write path that validates
// through it — today the BYO create route's `headerTemplate` AND `envTemplate`.
// `args` is deliberately NOT covered: a positional arg is legitimately a literal
// (`["-y", "fs-mcp"]`), so the same rule there would reject every valid stdio
// connector (FU-20 records that as its own separate decision).
const SECRET_PLACEHOLDER_RE = /\$\{[^}]+\}/;
const templateValue = z.string().refine((v) => v === "" || SECRET_PLACEHOLDER_RE.test(v), {
  message:
    'A connector template value must be empty or reference a secret with a ${...} placeholder ' +
    '(e.g. "Bearer ${TOKEN}"). Do not paste a real credential here — store it as a company ' +
    "secret and reference it, or bind one after install via " +
    "POST /companies/:companyId/mcp-connectors/:id/credentials.",
});
const templateRecord = z.record(z.string(), templateValue);

// C3: `source` is DELIBERATELY absent from the schema and stripped from the body
// before validation, so a client can never set it (a spoofed `source:"catalog"`
// would otherwise walk past the D7 catalog exemption). Every connector created
// here is forced to `"byo"` server-side. Other unknown keys are still rejected
// by `.strict()`.
const stripClientSource = (val: unknown): unknown => {
  if (val && typeof val === "object" && !Array.isArray(val) && "source" in val) {
    const { source: _source, ...rest } = val as Record<string, unknown>;
    return rest;
  }
  return val;
};

const createConnectorSchema = z.preprocess(
  stripClientSource,
  z
    .object({
      serverName: z.string().regex(SERVER_NAME_RE, {
        message: "serverName must match /^[a-z0-9-]+$/ (lowercase letters, digits, hyphen)",
      }),
      displayName: z.string().min(1).max(200),
      transport: z.enum(["http", "stdio"]),
      url: z.string().url().optional(),
      command: z.string().min(1).optional(),
      args: z.array(z.string()).optional().default([]),
      headerTemplate: templateRecord.optional().default({}),
      envTemplate: templateRecord.optional().default({}),
      secretRef: z.string().min(1).optional(),
    })
    .strict()
    .superRefine((val, ctx) => {
      if (val.transport === "http") {
        if (!val.url) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "http transport requires url" });
        }
        if (val.command !== undefined) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["command"], message: "http transport forbids command" });
        }
      } else if (val.transport === "stdio") {
        if (!val.command) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["command"], message: "stdio transport requires command" });
        }
        if (val.url !== undefined) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "stdio transport forbids url" });
        }
      }

      // FU-2 — a `${...}` placeholder in `command` is REFUSED, not substituted.
      //
      // DECISION (reject, not substitute): unlike `args`, `envTemplate` and
      // `headerTemplate` — which `buildConnectorSpecs` rewrites `${TOKEN}` ->
      // `${AOA_MCP_<name>_TOKEN}` — the executable `command` is copied verbatim,
      // so a placeholder there reaches the CLI as a literal `${...}` and spawns
      // as nothing. Two reasons to reject rather than close the substitution hole:
      //  1. `command` is the host-exec surface the whole D7 gate exists to guard.
      //     A secret belongs in an env var (or an arg the CLI expands), never
      //     baked into an executable path/name where it lands on a process command
      //     line (visible in `ps`/process listings) — the opposite of D5's
      //     "credential rides in the env, never in config/argv" model.
      //  2. Whether `${VAR}` even expands in the COMMAND position (vs args) is
      //     unverified across the four connector-capable CLIs; substituting on a
      //     guess risks shipping a literal `${VAR}` that authenticates as no-one
      //     (FU-21's failure mode in a new place). Rejecting is loud and early.
      // A secret in an executable path is almost always a mistake; the clean 400
      // here points the founder at args/env instead of failing silently at spawn.
      if (val.command !== undefined && SECRET_PLACEHOLDER_RE.test(val.command)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["command"],
          message:
            "command must not contain a ${...} placeholder. The executable command is not " +
            "secret-substituted (only args and header/env templates are), so a placeholder here " +
            "would be spawned literally. Reference the binary by its real path and put any secret " +
            "in an arg or env template instead.",
        });
      }
    }),
);

// PATCH is intentionally narrow: displayName + status only. Transport-relevant
// fields (transport/url/command/args/templates/serverName) cannot be edited —
// `.strict()` makes any such key a 400. Recreate the connector to change them.
//
// `secretRef` is NOT here on purpose, even though `ConnectorPatch` now carries it:
// changing the bound credential without re-deriving `status` in the same write is
// how a connector ends up `active` pointing at a dangling ref. Binding goes
// through POST …/:id/credentials, which validates the secret and re-derives.
//
// C2: the schema still accepts all three status values because `local_trusted`
// (which has no governance gate) may set any of them. The `authenticated`-mode
// restriction — status may ONLY be set to "disabled" — is enforced in the
// handler, because PATCH is currently the only activation path (the approval
// handler is deferred). Without it, `pending_approval → disabled → active`
// activates in two hops and reaches host-exec (for stdio) with no approval.
const updateConnectorSchema = z
  .object({
    displayName: z.string().min(1).max(200).optional(),
    status: z.enum(["active", "pending_approval", "disabled"]).optional(),
  })
  .strict()
  .refine((v) => v.displayName !== undefined || v.status !== undefined, {
    message: "Provide displayName and/or status",
  });

// C3 — the secret-binding body. `secretRef` and NOTHING else.
//
// The resulting status is DERIVED from `resolveConnectorStatus`, never accepted
// from the caller. `.strict()` (rather than quietly dropping unknown keys) is the
// load-bearing part: a request carrying `status: "active"` must be a 400. If it
// were silently ignored the caller would believe they had activated the
// connector, and the endpoint would read as a second activation surface next to
// the PATCH one the handler above works to close.
export const bindCredentialsSchema = z
  .object({ secretRef: z.string().min(1) })
  .strict();

const replaceAgentsSchema = z
  .object({
    agentIds: z.array(z.string().uuid()),
  })
  .strict();

/**
 * Catalog install body. `entryId` selects one of the server-fetched curated
 * entries; NOTHING else about the connector is client-controlled.
 *
 * `.strict()` is load-bearing twice over:
 *  1. A bare `z.object()` STRIPS unknown keys. If `consentToken` were ever
 *     dropped from this schema, the field would silently vanish from `req.body`
 *     and the consent gate would evaluate "no token supplied" — the gate would
 *     disappear rather than fail. Declaring it AND rejecting unknowns means a
 *     mistake here is a 400, never a silent downgrade.
 *  2. It REJECTS (rather than ignores) an injected `source` / `status` /
 *     `requiresSecret` / `trust` / `transport` / `command` / `args`. The BYO
 *     route strips a client `source` because it also accepts real connector
 *     fields; here every one of those axes comes from the catalog entry, so the
 *     honest answer to a client that sends one is "no", not "ignored".
 */
export const installFromCatalogSchema = z
  .object({
    entryId: z.string().min(1),
    consentToken: z.string().min(1).optional(),
  })
  .strict();

/**
 * Only an UNVERIFIED `stdio` entry needs command-bound consent.
 *
 * `stdio` because that is the transport that spawns a process on the AoA host;
 * `http` only makes a network call, so there is no command to consent to.
 * `!== "verified"` (rather than `=== "community"`) fails CLOSED: an unrecognised
 * or absent tier demands consent instead of skipping it.
 */
function requiresInstallConsent(entry: McpConnectorCatalogEntry): boolean {
  return entry.transport === "stdio" && entry.trust?.tier !== "verified";
}

/**
 * The exact argv a consent token binds to. Deliberately ONE definition shared by
 * the minting side and the verifying side — if the two ever constructed this
 * shape differently (say one passed `args: undefined` and the other `[]`) every
 * minted token would silently fail to verify, or worse, a token could verify
 * against argv it was not minted for.
 */
function consentSpecFor(entry: McpConnectorCatalogEntry) {
  return { command: entry.command ?? "", args: entry.args };
}

/**
 * Catalog entry -> `createConnector` input.
 *
 * D5 — template KEYS become EMPTY-VALUED entries. The catalog never carries a
 * credential (the shared schema constrains the key charsets precisely so a key
 * cannot smuggle a `Name: value` pair), so the connector is installed
 * credential-UNBOUND and the founder binds a real secret afterwards via
 * POST …/:id/credentials. `secretRef` is therefore always null here.
 *
 * `source` is the literal `"catalog"` — the vocabulary in
 * `company_mcp_connectors.ts` and in `assertTransportAllowed`. Any other string
 * (notably `"marketplace"`) would silently make the D7 catalog branch dead code
 * and route every catalog install through the BYO refusal instead.
 *
 * Pure and exported so the mapping is unit-tested without a route, a DB, or a
 * request.
 */
export function entryToCreateInput(
  entry: McpConnectorCatalogEntry,
  companyId: string,
  deploymentMode: string,
  actor: CreateConnectorInput["actor"],
): CreateConnectorInput {
  // Plain assignment onto a fresh `{}` is deliberate. Both the header and env
  // name charsets admit `__proto__`, and `obj["__proto__"] = ""` is a no-op
  // (assigning a non-object to [[Prototype]] is ignored) — so such a key is
  // DROPPED rather than propagated into a downstream header/env writer, and
  // `Object.prototype` is never touched. `Object.fromEntries` would instead
  // define it as a real own property and carry it downstream.
  const headerTemplate: Record<string, string> = {};
  for (const key of entry.headerTemplateKeys) headerTemplate[key] = "";
  const envTemplate: Record<string, string> = {};
  for (const key of entry.envTemplateKeys) envTemplate[key] = "";

  return {
    companyId,
    serverName: entry.serverName,
    displayName: entry.displayName,
    transport: entry.transport,
    url: entry.url ?? null,
    command: entry.command ?? null,
    args: entry.args,
    headerTemplate,
    envTemplate,
    secretRef: null,
    requiresSecret: entry.requiresSecret,
    source: "catalog",
    // Persist the entry's trust tier so the FU-19 delivery-time D7 re-check can
    // honor the `catalog + verified` exemption after a mode conversion, exactly
    // like the create-time gate does. `entry.trust.tier` is always set (the
    // shared schema defaults it to "community" fail-closed); `?.` is defensive.
    trustTier: entry.trust?.tier ?? null,
    deploymentMode,
    actor,
  };
}

export interface McpConnectorRouteOptions {
  /** Injectable so route tests never touch the network. */
  catalog?: ConnectorCatalogService;
}

export function mcpConnectorRoutes(db: Db, opts: McpConnectorRouteOptions = {}) {
  const router = Router();
  const svc = mcpConnectorService(db);
  const secretsSvc = secretService(db);
  const approvalsSvc = approvalService(db);
  // Constructing this performs no I/O — the fetch happens on the first `load()`,
  // i.e. only when a founder actually opens the shelf.
  const connectorCatalog = opts.catalog ?? resolveConnectorCatalogService();

  // List — any board member with access to the company.
  router.get("/companies/:companyId/mcp-connectors", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const rows = await svc.list(companyId);
    res.json(rows);
  });

  // The curated shelf — founder only, and THE way the UI obtains a consent token.
  //
  // WHY THE TOKEN IS MINTED HERE, in the same response that carries the command:
  // the token's whole job is to bind consent to the exact `(entryId, command,
  // args)` the founder was shown, because `connectors.json` re-syncs on a 6h TTL
  // and the entry rendered in a dialog is a DIFFERENT read of a mutable remote
  // file from the entry read at install time. Minting from the same read that is
  // serialised into this response makes "the bytes displayed" and "the bytes
  // signed" the same bytes BY CONSTRUCTION — there is no window in which a client
  // could render entry X's command while holding a token bound to entry Y.
  //
  // A separate `POST …/consent` mint endpoint would give the same binding but
  // costs a second round trip and a second catalog read that can disagree with
  // this one. It is NOT more secure: the server cannot prove a human read a
  // dialog either way, and an attacker holding a founder session could call
  // either endpoint. The token is a TOCTOU binding, not an anti-automation
  // device — so the cheaper shape with the stronger same-read invariant wins.
  //
  // Founder-only (not board-wide like the list above) because this endpoint mints
  // signed install material and only a founder can act on it. Loosening later is
  // safe; tightening later would be a breaking change.
  //
  // ⚠ Task 14 (UI): `consentExpiresAt` is present so the shelf can REFETCH before
  // opening the install dialog. Tokens live 15 minutes; rendering a dialog from a
  // shelf loaded an hour ago will 400 with `expired`.
  router.get("/companies/:companyId/mcp-connectors/catalog", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    await assertRole(db, req, companyId, "founder");

    const nowMs = Date.now();
    const { entries, stale } = await connectorCatalog.load(nowMs);
    const deploymentMode = loadConfig().deploymentMode;

    // Resolved once, and only if some entry actually needs it. A missing signing
    // secret must degrade to "no tokens" (installs then fail loudly) rather than
    // 500 the whole shelf.
    let secret: string | null = null;
    if (entries.some(requiresInstallConsent)) {
      try {
        secret = resolveConsentSecret();
      } catch (err) {
        logger.warn(
          { err },
          "connector shelf: no signing secret available — consent tokens omitted",
        );
      }
    }

    const shelf = entries.map((entry) => {
      // A PROJECTION of the real gate, not a second implementation of it — same
      // function, same arguments the install handler will pass, so the shelf can
      // never disagree with what install will do.
      //
      // `unavailableReason` carries the GATE'S OWN message rather than letting the
      // client derive one. Today the gate has a single refusal branch, so a
      // client-side constant happens to be exact — but that is an accident of the
      // current implementation, and a second branch would turn it into a confident
      // lie about why a capability disappeared. Sourcing the copy from the thrown
      // error means the refusal the founder reads is always the refusal that
      // actually happened.
      let installable = true;
      let unavailableReason: string | undefined;
      try {
        assertTransportAllowed(entry.transport, deploymentMode, "catalog", entry.trust?.tier);
      } catch (err) {
        installable = false;
        unavailableReason =
          err instanceof Error && err.message
            ? err.message
            : "This connector cannot be installed in this deployment.";
      }

      const consentRequired = requiresInstallConsent(entry);

      // FU-24 — a consent-gated stdio entry is installable ONLY if a consent
      // token can be minted, and a token cannot be minted without the server
      // signing secret. When the secret is unavailable the install POST would
      // reject on the missing token, so presenting the entry as `installable`
      // renders a dead Install button + consent dialog that always 400s. Mark it
      // unavailable with the real reason instead — the same shape D7-refused
      // entries already use, so "why can't I install this?" is always answered on
      // the shelf rather than buried in a log line. `installable` is only cleared
      // here when D7 already permitted it (still true), so this never clobbers the
      // D7 refusal message.
      if (installable && consentRequired && !secret) {
        installable = false;
        unavailableReason =
          "This connector runs a command on the AoA host and needs an install " +
          "confirmation the server cannot sign: no signing secret " +
          "(BETTER_AUTH_SECRET or AOA_AGENT_JWT_SECRET) is configured. Set one to " +
          "enable consent-gated connector installs.";
      }

      const base = {
        ...entry,
        installable,
        consentRequired,
        ...(unavailableReason ? { unavailableReason } : {}),
      };

      // No token for an entry D7 will refuse, nor for one we could not sign
      // (installable was just cleared above). Handing one out would suggest
      // consent is the thing standing in the way, when the deployment simply may
      // not run host code at all. The `!secret` guard is retained so a token is
      // never minted against a null secret even if the branches above change.
      if (!consentRequired || !installable || !secret) return base;

      return {
        ...base,
        consentToken: mintConsentToken(secret, entry.id, consentSpecFor(entry), nowMs),
        consentExpiresAt: nowMs + CONSENT_TOKEN_TTL_MS,
      };
    });

    res.json({ entries: shelf, stale });
  });

  // Install from the curated catalog — founder only.
  //
  // C5 — RBAC IS DELIBERATELY *NOT* `canInstallType` from
  // routes/marketplace-installs.ts. That helper returns true for `team_lead` on
  // anything that is not a plugin, so routing through it would make the
  // marketplace a WEAKER door onto an object whose own CRUD (create/update/
  // delete/agent-assignment, above) is founder-only. Connectors are not catalog
  // items and do not go through marketplace-install/orchestrator.ts at all.
  //
  // ORDER OF OPERATIONS IS THE SECURITY PROPERTY. authz, then entry resolution,
  // then D7, then consent, then the shared create. In particular:
  //
  //  - D7 (`assertTransportAllowed`) is AUTHORIZATION: may this deployment cause
  //    a command to execute on the AoA host at all? It runs first, before any
  //    write, and its answer is final.
  //  - The consent token is a UX/TOCTOU binding: were these the exact bytes the
  //    founder was shown? It runs second, and ONLY for unverified stdio.
  //
  // NEITHER SUBSTITUTES FOR THE OTHER. A perfectly valid consent token does not
  // rescue an unverified stdio entry from D7 in `authenticated` mode — the gate
  // has already thrown by the time the consent branch is reached. There is a test
  // pinning exactly that; it is the most important assertion in this file's suite.
  router.post(
    "/companies/:companyId/mcp-connectors/install",
    validate(installFromCatalogSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");

      const { entryId, consentToken } = req.body as z.infer<typeof installFromCatalogSchema>;

      // Linear scan over the fetched array on purpose: a keyed object lookup
      // would make `entryId: "__proto__"` resolve to something that is not an
      // entry. The client picks WHICH curated entry, never what is in it.
      const { entries } = await connectorCatalog.load(Date.now());
      const entry = entries.find((e) => e.id === entryId);
      if (!entry) {
        res.status(404).json({ error: "Connector not found in catalog" });
        return;
      }

      const deploymentMode = loadConfig().deploymentMode;

      // (1) D7 — authorization. Before any write, independent of consent.
      assertTransportAllowed(entry.transport, deploymentMode, "catalog", entry.trust?.tier);

      // (2) Consent — UX/TOCTOU binding, unverified stdio only.
      if (requiresInstallConsent(entry)) {
        if (!consentToken) {
          throw badRequest(
            "This connector runs a command on the AoA host and its publisher is not verified. " +
              "Review the exact command on the connector shelf and confirm it to continue.",
          );
        }
        // `resolveConsentSecret()` throwing here is a server misconfiguration and
        // is allowed to surface as a 500: failing the install closed is correct,
        // and silently treating "no secret" as "consent satisfied" would be the
        // one outcome worse than an error page.
        const verdict = verifyConsentToken(
          resolveConsentSecret(),
          entry.id,
          consentSpecFor(entry),
          consentToken,
          Date.now(),
        );
        if (!verdict.ok) {
          // The reason is named because the fixes differ: `expired` means reload
          // the shelf, `signature_mismatch` means the command changed under you.
          throw badRequest(
            `Install confirmation is not valid for this connector (${verdict.reason}). ` +
              "Reload the connector shelf, review the command, and confirm again.",
          );
        }
      }

      const actor = getActorInfo(req);

      // (3) The SHARED create service — same 409, secretRef check, status
      // derivation, approval and activity log as the BYO route. Nothing about
      // governance is re-implemented here.
      const { connector: created, approvalId } = await createConnector(
        { svc, secretsSvc, approvalsSvc, logActivity: (logEntry) => logActivity(db, logEntry) },
        entryToCreateInput(entry, companyId, deploymentMode, actor),
      );

      res.status(201).json({ ...created, approvalId });
    },
  );

  // Create — founder only.
  router.post(
    "/companies/:companyId/mcp-connectors",
    validate(createConnectorSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");

      const body = req.body as z.infer<typeof createConnectorSchema>;

      // C3: this route only ever creates BYO connectors. Any client `source` was
      // already stripped in the schema; the value is fixed server-side.
      const source = "byo";

      const deploymentMode = loadConfig().deploymentMode;

      // C1/D7: reject a host-executing stdio connector in a shared deployment
      // BEFORE any write. `source` is the server-forced "byo" here, so the
      // catalog exemption is unreachable from this route by construction; the
      // trust tier is passed as an explicit `undefined` because a BYO connector
      // has no catalog provenance and therefore no tier to vouch for it (C4).
      assertTransportAllowed(body.transport, deploymentMode, source, undefined);

      const actor = getActorInfo(req);

      // Everything past the D7 gate — the (companyId, serverName) 409, the
      // secretRef-existence check, status derivation, the approval, and the
      // activity log — lives in the SHARED create service so the catalog install
      // route cannot fork it into an untested copy.
      const { connector: created, approvalId } = await createConnector(
        { svc, secretsSvc, approvalsSvc, logActivity: (entry) => logActivity(db, entry) },
        {
          companyId,
          serverName: body.serverName,
          displayName: body.displayName,
          transport: body.transport,
          url: body.url ?? null,
          command: body.command ?? null,
          args: body.args,
          headerTemplate: body.headerTemplate,
          envTemplate: body.envTemplate,
          secretRef: body.secretRef ?? null,
          // BYO: the founder supplies every credential up front, so a BYO
          // connector is never in the "installed but uncredentialed" state that
          // `requiresSecret` exists to describe.
          requiresSecret: false,
          source,
          // BYO has no catalog provenance, so no trust tier can vouch for it. Null
          // means the FU-19 delivery re-check treats it as non-exempt (correctly
          // dropped in `authenticated` — the very case D7 exists to prevent).
          trustTier: null,
          deploymentMode,
          actor,
        },
      );

      res.status(201).json({ ...created, approvalId });
    },
  );

  // Update displayName / status — founder only.
  router.patch(
    "/companies/:companyId/mcp-connectors/:id",
    validate(updateConnectorSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");

      const existing = await svc.getById(id);
      if (!existing || existing.companyId !== companyId) {
        res.status(404).json({ error: "Connector not found" });
        return;
      }

      const deploymentMode = loadConfig().deploymentMode;
      const nextStatus = (req.body as z.infer<typeof updateConnectorSchema>).status;

      // FU-15 — CREDENTIAL precondition on activation. Applies in EVERY deployment
      // mode, and is checked before the governance gate below so it is not shadowed
      // in `authenticated` (where governance would refuse first).
      //
      // Governance and credentials are orthogonal, and `local_trusted`'s PATCH
      // freedom is a decision about GOVERNANCE only. A connector with
      // `requiresSecret` and no bound secret cannot authenticate no matter who
      // flips it, so permitting `active` there just manufactures a broken connector
      // that `selectConnectorRowsForAgent` then delivers to agents. The old
      // exemption was written when the two axes were still one.
      //
      // Routed through `resolveConnectorStatus` rather than hand-written as
      // `requiresSecret && !secretRef`, so the credential rule keeps living in
      // exactly one place (plan invariant #3) and this gate inherits any future
      // change to it. `approved: true` deliberately NEUTRALISES the governance axis
      // — that axis is the next block's job — which leaves the credential axis as
      // the only thing that can make the answer anything other than "active".
      if (nextStatus === "active") {
        const credentialsPermitActive =
          resolveConnectorStatus({
            deploymentMode,
            approved: true,
            // `!== false` fails CLOSED: anything that is not explicitly false is
            // treated as "needs a secret". `=== true` would let a malformed value
            // ("true", 1) read as "no secret needed" and activate. The column is
            // `notNull().default(false)`, so this is defensive only.
            requiresSecret: existing.requiresSecret !== false,
            // Empty string names no secret, so it is not a bound credential.
            hasSecret: Boolean(existing.secretRef),
          }) === "active";
        if (!credentialsPermitActive) {
          throw badRequest(
            "This connector requires a credential and none is bound, so it cannot be " +
              "activated. Bind one first with POST /companies/:companyId/mcp-connectors/:id/" +
              "credentials.",
          );
        }
      }

      // C2: in a shared deployment, PATCH may only DEACTIVATE. Activation
      // (active) and re-arming for approval (pending_approval) must not be
      // reachable through PATCH — they would bypass the approval gate, including
      // the two-hop pending→disabled→active path. Deactivation is always safe.
      // local_trusted has no governance gate, so it is unrestricted — on the
      // governance axis only; the credential precondition above still applies.
      if (
        deploymentMode !== "local_trusted" &&
        nextStatus !== undefined &&
        nextStatus !== "disabled"
      ) {
        throw badRequest(
          "In this deployment a connector can only be disabled via update; activation flows " +
            "through connector approval, not this endpoint.",
        );
      }

      const updated = await svc.update(id, req.body);
      if (!updated) {
        res.status(404).json({ error: "Connector not found" });
        return;
      }

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "mcp_connector.updated",
        entityType: "mcp_connector",
        entityId: id,
        details: req.body,
      });

      res.json(updated);
    },
  );

  // Bind a company secret to a connector, then RE-DERIVE its status — founder only.
  //
  // C3: this is the missing middle of the central journey. A catalog connector is
  // installed unconfigured (`needs_credentials`) and must never reach an agent
  // until a credential is bound; before this route there was no way to set
  // `secretRef` after create, so `needs_credentials → active` was unreachable.
  router.post(
    "/companies/:companyId/mcp-connectors/:id/credentials",
    validate(bindCredentialsSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");

      const existing = await svc.getById(id);
      if (!existing || existing.companyId !== companyId) {
        res.status(404).json({ error: "Connector not found" });
        return;
      }

      const { secretRef } = req.body as z.infer<typeof bindCredentialsSchema>;

      // Same A19/A20 rule as create: a secretRef must name an EXISTING company
      // secret. Rejecting the dangling ref here beats letting the delivery path
      // silently drop the connector at run time. Scoped to this company, so a
      // founder cannot bind another tenant's secret.
      const secret = await secretsSvc.getByName(companyId, secretRef);
      if (!secret) {
        throw badRequest(`secretRef "${secretRef}" does not reference an existing secret`);
      }

      // HOW `approved` IS INFERRED, and why the current status is a sound signal.
      //
      // There is no approval pointer on the connector row, so the status itself is
      // the only governance evidence available. It is sufficient because status is
      // the OUTPUT of the governance axis, and only two writers produce it:
      //   - create  (mcp-connector-create.ts): in a non-local_trusted deployment a
      //     new connector is ALWAYS `pending_approval`, whatever its credentials.
      //   - approve/reject (applyConnectorApproval / applyConnectorRejection).
      // So in a shared deployment a connector can reach `needs_credentials` or
      // `active` ONLY by having been approved, and `pending_approval` means it has
      // not been. That makes the mapping below a reading of governance state, not a
      // guess:
      //   pending_approval → not yet approved  → binding leaves it pending (no bypass)
      //   disabled         → rejected/deactivated
      //   needs_credentials / active → governance already satisfied
      //
      // `disabled` is short-circuited rather than fed to the resolver: with
      // approved=true the resolver would answer `active`, i.e. binding a secret
      // would RESURRECT a connector the board rejected.
      //
      // In `authenticated`, `disabled` is effectively TERMINAL. Nothing re-enables
      // it: PATCH → active is refused by the C2 governance gate, `applyConnectorApproval`
      // short-circuits `disabled` too, and an `install_mcp_connector` approval is only
      // ever created inside `createConnector` — no route re-requests approval for an
      // existing connector. Recreating the connector is the way back. In
      // `local_trusted`, PATCH → active re-enables it (no governance gate there).
      //
      // Nothing here decides `active` on its own — `resolveConnectorStatus` does,
      // and it is unconditionally incapable of returning `active` while the
      // connector requires a secret it does not have.
      const approved = existing.status !== "pending_approval" && existing.status !== "disabled";
      const nextStatus =
        existing.status === "disabled"
          ? "disabled"
          : resolveConnectorStatus({
            deploymentMode: loadConfig().deploymentMode,
            approved,
            // `!== false` fails closed; see applyConnectorApproval for the rationale.
            requiresSecret: existing.requiresSecret !== false,
            // A non-empty secretRef was just validated to exist, so it IS bound.
            hasSecret: true,
          });

      // Guarded on the status we READ: `nextStatus` was derived from that snapshot,
      // so if the board approved (or the founder disabled) between the read and here,
      // this matches 0 rows rather than overwriting the newer state with a stale
      // derivation. The damaging interleave is exactly this one — bind landing last
      // in `authenticated` would park the connector at `pending_approval` with the
      // approval already closed and no way back. A 409 tells the founder to retry,
      // which then derives from the current row.
      const updated = await svc.updateIfStatus(id, existing.status, {
        secretRef,
        status: nextStatus,
      });
      if (!updated) {
        throw conflict(
          "This connector changed while the credential was being bound. Retry the request.",
        );
      }

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "mcp_connector.credentials_bound",
        entityType: "mcp_connector",
        entityId: id,
        // `secretRef` is a secret NAME, never a secret value — safe to log, and it
        // is what makes a later "which credential was bound?" audit answerable.
        details: { secretRef, status: nextStatus },
      });

      res.json(updated);
    },
  );

  // Delete — founder only.
  router.delete("/companies/:companyId/mcp-connectors/:id", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    await assertRole(db, req, companyId, "founder");

    const existing = await svc.getById(id);
    if (!existing || existing.companyId !== companyId) {
      res.status(404).json({ error: "Connector not found" });
      return;
    }

    const removed = await svc.remove(id);
    if (!removed) {
      res.status(404).json({ error: "Connector not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "mcp_connector.deleted",
      entityType: "mcp_connector",
      entityId: id,
      details: { serverName: removed.serverName },
    });

    res.json(removed);
  });

  // Replace the enabled-agent set — founder only.
  router.put(
    "/companies/:companyId/mcp-connectors/:id/agents",
    validate(replaceAgentsSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");

      const existing = await svc.getById(id);
      if (!existing || existing.companyId !== companyId) {
        res.status(404).json({ error: "Connector not found" });
        return;
      }

      const { agentIds } = req.body as z.infer<typeof replaceAgentsSchema>;

      // Every agent must belong to THIS company — a connector must never be
      // granted to an agent from another tenant.
      const owned = await svc.agentIdsInCompany(companyId, agentIds);
      const ownedSet = new Set(owned);
      const foreign = [...new Set(agentIds)].filter((agentId) => !ownedSet.has(agentId));
      if (foreign.length > 0) {
        throw forbidden(`Agents do not belong to this company: ${foreign.join(", ")}`);
      }

      await svc.replaceAgents(companyId, id, agentIds);

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "mcp_connector.agents_replaced",
        entityType: "mcp_connector",
        entityId: id,
        details: { agentIds: [...new Set(agentIds)] },
      });

      res.json({ connectorId: id, agentIds: [...new Set(agentIds)] });
    },
  );

  return router;
}
