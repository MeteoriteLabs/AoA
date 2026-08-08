#!/usr/bin/env node
/**
 * check-distributed-execution-foundation.mjs
 *
 * Dependency-free structural checker for the E0 distributed-execution foundation
 * documents. It is the always-on `policy`-job guard for the re-platform program
 * and the shared, extensible base every later FND ticket builds on.
 *
 * FND-001 owns the workload lifecycle contract. This checker:
 *   1. Parses the machine-readable authority
 *      `docs/architecture/distributed-execution-lifecycles.json`.
 *   2. Validates each lifecycle's state set, initial/terminal sets, allowed
 *      edges, graph reachability, terminal immutability, and guarded-edge
 *      reasons (job `dead_letter` requires `policy_exhausted`; job `failed`
 *      requires `non_retryable_failure`; no reason may appear on an unguarded
 *      edge).
 *   3. Validates the forbidden cross-lifecycle edges reference real
 *      lifecycles/states and genuinely cross machines.
 *   4. Extracts the human-readable transition tables from
 *      `docs/architecture/distributed-execution-lifecycles.md` and fails on any
 *      JSON<->Markdown drift in either direction (edges and guard reasons).
 *   5. Confirms the required Markdown headings, workload-class tokens, and the
 *      Decision #121 record.
 *
 * FND-002 extends it with the distributed-execution authority contract. This
 * checker additionally:
 *   6. Requires `docs/architecture/distributed-execution-authority.md` and its
 *      Decision #121 back-reference.
 *   7. Parses the authority matrix and validates every required authority row
 *      (state -> authority -> worker behavior), the single-writer
 *      `ExecutionOwner` cutover enum (exactly `legacy | distributed`), the
 *      late/orphan-output stale-commit and no-auto-promote invariants, and the
 *      "no peer replica" database invariant — as structured rules, never bare
 *      substring presence.
 *
 * FND-003 extends it with the distributed-execution threat model and control
 * ownership. This checker additionally:
 *   8. Requires `docs/architecture/distributed-execution-threat-model.md`, its
 *      required headings/fragments, and the Decision #121 threat-model
 *      back-reference.
 *   9. Parses `docs/architecture/distributed-execution-threat-controls.json`
 *      (the authoritative record) and validates every crossing/control object:
 *      the exact required field set, non-empty string values, unique stable
 *      IDs, known severity/verification-lane values, non-empty owner-ticket
 *      arrays whose IDs all exist as defined backlog tickets in
 *      `docs/replatform/program-design.md`, and a release test for every
 *      Critical/High crossing.
 *  10. Enforces exact JSON<->Markdown register parity: the complete crossing ID
 *      set (both directions, count included) plus per-ID
 *      threat/severity/control/verification/owner parity — every control ID,
 *      not just the first/last — and the residual release-exclusion set.
 *
 * String-fragment presence alone is never sufficient evidence for this
 * contract; the structured graph/table parity above is the real gate.
 *
 * Usage:
 *   node scripts/check-distributed-execution-foundation.mjs
 *   node scripts/check-distributed-execution-foundation.mjs --root <fixture-dir>
 *
 * `--root` exists only for the dependency-free `node:test` harness in
 * `check-distributed-execution-foundation.test.mjs`; it defaults to
 * `process.cwd()` in normal and CI use.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const LIFECYCLES_JSON = "docs/architecture/distributed-execution-lifecycles.json";
const LIFECYCLES_MD = "docs/architecture/distributed-execution-lifecycles.md";
const DECISIONS_MD = "docs/architecture/decisions.md";
const AUTHORITY_MD = "docs/architecture/distributed-execution-authority.md";

const REQUIRED_LIFECYCLES = [
  "job",
  "attempt",
  "lease",
  "browserSession",
  "serviceDesired",
  "serviceInstance",
];

const REQUIRED_LIFECYCLE_FIELDS = [
  "title",
  "markdownHeading",
  "initial",
  "states",
  "terminal",
  "guards",
  "allowed",
];

const REQUIRED_MD_HEADINGS = [
  "# Distributed Execution Lifecycles",
  "## Shared identity and ownership",
  "## Job lifecycle",
  "## Attempt lifecycle",
  "## Lease lifecycle",
  "## Batch lifecycle",
  "## Browser-session lifecycle",
  "## Service desired-state lifecycle",
  "## Service-instance lifecycle",
  "## Forbidden cross-lifecycle transitions",
  "## Lifecycle diagrams",
  "## Worked journeys",
  "## Deadlines and provider interruption",
  "## Cancellation and lease-loss rules",
  "## Legacy concept mapping",
];

const REQUIRED_WORKLOAD_TOKENS = ["batch", "browser_session", "service"];

const DECISION_121_HEADING =
  "## Decision #121 — Cloud control plane uses a fenced outbound worker protocol";

const FORBIDDEN_TABLE_HEADING = "## Forbidden cross-lifecycle transitions";

// --- FND-002: distributed-execution authority contract -----------------------

const AUTHORITY_REQUIRED_FRAGMENTS = [
  "# Distributed Execution Authority and Synchronization",
  "## Authority matrix",
  "## Single-writer cutover",
  "## Worker event synchronization",
  "## Workspace and artifact synchronization",
  "## Late and orphan output",
  "No AoA database is a peer replica",
];

const AUTHORITY_MATRIX_HEADING = "## Authority matrix";
const SINGLE_WRITER_HEADING = "## Single-writer cutover";
const LATE_OUTPUT_HEADING = "## Late and orphan output";

// --- FND-003: distributed-execution threat model + control ownership ---------

const THREAT_MODEL_MD = "docs/architecture/distributed-execution-threat-model.md";
const THREAT_CONTROLS_JSON = "docs/architecture/distributed-execution-threat-controls.json";
const PROGRAM_DESIGN_MD = "docs/replatform/program-design.md";

// Step-1 presence gate: the Markdown render must carry these literal fragments.
const THREAT_MODEL_FRAGMENTS = [
  "# Distributed Execution Threat Model",
  "## Trust boundaries",
  "## Threat and control register",
  "## Residual risks and release exclusions",
  "DE-01",
  "DE-16",
  "DE-17",
  "REL-001",
  "cloud plugins remain disabled",
];

// Every crossing/control object in the JSON must carry all of these fields; the
// JSON is authoritative and the Markdown register is a rendered view of them.
const THREAT_CROSSING_REQUIRED_FIELDS = [
  "id",
  "trustedSide",
  "lessTrustedSide",
  "authentication",
  "authorization",
  "confidentiality",
  "integrity",
  "revocation",
  "audit",
  "failureMode",
  "severity",
  "ownerTickets",
  "verificationLane",
];

const THREAT_KNOWN_SEVERITIES = new Set(["Critical", "High", "Medium", "Low"]);
const THREAT_KNOWN_LANES = new Set(["D0", "D1", "D2", "D3", "D4", "D5", "D6"]);
// A release test is required for every crossing at these severities.
const THREAT_RELEASE_SEVERITIES = new Set(["Critical", "High"]);
const REL_OWNER_RE = /^REL-\d+$/;
// A backlog ticket ID token (used both to parse program-design.md and owner cells).
const TICKET_ID_RE = /[A-Z][A-Z0-9]*-\d+/g;

const THREAT_REGISTER_HEADING = "## Threat and control register";
const THREAT_REGISTER_HEADER = ["ID", "Threat", "Severity", "Required control", "Verification", "Owner"];
const RESIDUAL_HEADING = "## Residual risks and release exclusions";

// The residual-risk section must explicitly exclude each of these from the
// shipped surface (the hardening amendment's named release exclusions).
const RESIDUAL_EXCLUSIONS = [
  "public service ingress",
  "cloud plugins",
  "unvalidated gVisor bridge egress",
  "active-active multi-region writes",
  "unattended orphan-output application",
];

const AUTHORITY_MATRIX_HEADER = ["State", "Authority", "Worker behavior"];

// Each authority row is validated verbatim (state -> authority -> worker
// behavior). A missing or altered row is a structured failure, not a substring.
const EXPECTED_AUTHORITY_ROWS = [
  {
    state: "Organizations, memberships, policy, jobs, leases, costs, audit",
    authority: "Control-plane PostgreSQL",
    worker: "Read through scoped envelopes/APIs; append events only",
  },
  {
    state: "Memory items, visibility, retrieval audit, actor scope",
    authority: "Control-plane PostgreSQL and memory services",
    worker: "Consume an authorized immutable context input or scoped API; never query memory tables",
  },
  {
    state: "Connector OAuth grants, refresh leases, token bundles",
    authority: "Control-plane MCP OAuth broker",
    worker: "Request a lease-scoped opaque handle; never receive refresh-token authority",
  },
  {
    state: "Source history",
    authority: "Customer-declared Git remote/repository",
    worker: "Stage declared base; return patch or commit metadata",
  },
  {
    state: "Snapshots, logs, traces, downloads, checkpoints, artifacts",
    authority: "S3-compatible object storage",
    worker: "Transfer through short-lived prefix-scoped grants",
  },
  {
    state: "Unacknowledged worker events",
    authority: "Encrypted worker SQLite outbox",
    worker: "Retain until cumulative ACK",
  },
  {
    state: "Sandbox filesystem",
    authority: "Ephemeral cache",
    worker: "Never authoritative after lease loss or sandbox termination",
  },
];

// Words that negate a forbidden assertion in a single sentence.
const NEGATION_RE = /\b(?:no|not|never|cannot|can\s?not)\b/i;

/** Read a file; classify ENOENT as `missing`, everything else as `unreadable`. */
async function readOrError(root, relPath, errors) {
  try {
    return await readFile(path.join(root, relPath), "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      errors.push(`${relPath}: missing`);
    } else {
      errors.push(`${relPath}: unreadable (${(err && err.code) || "error"})`);
    }
    return null;
  }
}

/** Split `| a | b |` into trimmed non-empty cells. */
function splitRow(line) {
  const trimmed = line.trim();
  const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((c) => c.trim());
}

function isTableLine(line) {
  return line.trim().startsWith("|");
}

function isSeparatorRow(cells) {
  return cells.every((c) => /^:?-{1,}:?$/.test(c));
}

/** Return the body text of a `## heading` section (until the next `##`/`#`). */
function sectionBody(md, heading) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return null;
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const l = lines[i];
    if (/^#{1,2}\s/.test(l)) break;
    body.push(l);
  }
  return body.join("\n");
}

/**
 * Extract the first `| From | To |` table from a section body as a list of
 * { from, to, reason } edges. Reasons are encoded in the `To` cell as
 * `` `state` (`reason`) ``. Returns null when no From/To table is present.
 */
function extractTransitionTable(body) {
  if (body == null) return null;
  const lines = body.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    if (isTableLine(lines[i])) {
      const header = splitRow(lines[i]);
      if (header.length === 2 && header[0] === "From" && header[1] === "To") {
        // Consume the table.
        const rows = [];
        let j = i + 1;
        // Skip separator row.
        if (j < lines.length && isTableLine(lines[j]) && isSeparatorRow(splitRow(lines[j]))) {
          j += 1;
        }
        for (; j < lines.length && isTableLine(lines[j]); j += 1) {
          rows.push(splitRow(lines[j]));
        }
        return { rows };
      }
    }
    i += 1;
  }
  return null;
}

/** Parse a single backticked lowercase state token from a `From` cell. */
function parseFromCell(cell) {
  const m = /`([a-z_]+)`/.exec(cell);
  return m ? m[1] : null;
}

/** Parse `` `state` (`reason`) `` tokens from a `To` cell into {to, reason}. */
function parseToCell(cell) {
  const out = [];
  const re = /`([a-z_]+)`(?:\s*\(`([a-z_]+)`\))?/g;
  let m;
  while ((m = re.exec(cell)) !== null) {
    out.push({ to: m[1], reason: m[2] ?? null });
  }
  return out;
}

/** Parse a single `` `lifecycle:state` `` token (forbidden-edge table cell). */
function parseNamespacedCell(cell) {
  const m = /`([A-Za-z]+:[a-z_]+)`/.exec(cell);
  return m ? m[1] : null;
}

function edgeKey(from, to) {
  return `${from}->${to}`;
}

/** Build the JSON allowed-edge map for one lifecycle: from->to => reason|null. */
function jsonEdgeMap(lifecycle) {
  const map = new Map();
  for (const edge of lifecycle.allowed) {
    map.set(edgeKey(edge.from, edge.to), edge.reason ?? null);
  }
  return map;
}

/** Build the Markdown allowed-edge map for one lifecycle from its table rows. */
function markdownEdgeMap(table, lcName, errors) {
  const map = new Map();
  for (const cells of table.rows) {
    if (cells.length !== 2) {
      errors.push(`${LIFECYCLES_MD}: ${lcName} table row is not two columns: ${JSON.stringify(cells)}`);
      continue;
    }
    const from = parseFromCell(cells[0]);
    if (!from) {
      errors.push(`${LIFECYCLES_MD}: ${lcName} table row has an unparseable From cell: ${JSON.stringify(cells[0])}`);
      continue;
    }
    const targets = parseToCell(cells[1]);
    if (targets.length === 0) {
      errors.push(`${LIFECYCLES_MD}: ${lcName} table row for "${from}" has no To targets`);
      continue;
    }
    for (const { to, reason } of targets) {
      map.set(edgeKey(from, to), reason ?? null);
    }
  }
  return map;
}

function validateLifecycleGraph(name, lc, errors) {
  const states = new Set(lc.states);
  const terminal = new Set(lc.terminal);
  const initial = new Set(lc.initial);

  for (const t of lc.terminal) {
    if (!states.has(t)) {
      errors.push(`${LIFECYCLES_JSON}: ${name} terminal "${t}" is not in the state set`);
    }
  }
  for (const s of lc.initial) {
    if (!states.has(s)) {
      errors.push(`${LIFECYCLES_JSON}: ${name} initial "${s}" is not in the state set`);
    }
  }

  // Adjacency + unknown-state edges.
  const outgoing = new Map();
  for (const s of lc.states) outgoing.set(s, []);
  for (const edge of lc.allowed) {
    if (!states.has(edge.from)) {
      errors.push(`${LIFECYCLES_JSON}: ${name} edge ${edge.from}->${edge.to} references unknown state "${edge.from}"`);
    }
    if (!states.has(edge.to)) {
      errors.push(`${LIFECYCLES_JSON}: ${name} edge ${edge.from}->${edge.to} references unknown state "${edge.to}"`);
    }
    if (outgoing.has(edge.from)) outgoing.get(edge.from).push(edge.to);
  }

  // Terminal immutability: no outgoing edge from a terminal state.
  for (const [from, tos] of outgoing) {
    if (terminal.has(from) && tos.length > 0) {
      errors.push(`${LIFECYCLES_JSON}: ${name} terminal state "${from}" has an outgoing edge to "${tos[0]}"`);
    }
  }

  // Every non-terminal state must have at least one outgoing edge (no silent dead-ends).
  for (const s of lc.states) {
    if (!terminal.has(s) && (outgoing.get(s) || []).length === 0) {
      errors.push(`${LIFECYCLES_JSON}: ${name} non-terminal state "${s}" has no outgoing edge`);
    }
  }

  // Reachability: BFS from initial states covers every state.
  const seen = new Set(initial);
  const queue = [...initial];
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const to of outgoing.get(cur) || []) {
      if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  for (const s of lc.states) {
    if (!seen.has(s)) {
      errors.push(`${LIFECYCLES_JSON}: ${name} state "${s}" is unreachable from any initial state`);
    }
  }

  // Guarded edges.
  const guards = lc.guards || {};
  for (const [target, reason] of Object.entries(guards)) {
    if (!states.has(target)) {
      errors.push(`${LIFECYCLES_JSON}: ${name} guard targets unknown state "${target}"`);
      continue;
    }
    const incoming = lc.allowed.filter((e) => e.to === target);
    if (incoming.length === 0) {
      errors.push(`${LIFECYCLES_JSON}: ${name} guard for "${target}" has no incoming edge`);
    }
    for (const e of incoming) {
      if ((e.reason ?? null) !== reason) {
        errors.push(`${LIFECYCLES_JSON}: ${name} edge ${e.from}->${e.to} must carry guard reason "${reason}" but has ${JSON.stringify(e.reason ?? null)}`);
      }
    }
  }
  // A reason may only appear on an edge into a matching guarded target.
  for (const e of lc.allowed) {
    if (e.reason == null) continue;
    if (guards[e.to] === undefined) {
      errors.push(`${LIFECYCLES_JSON}: ${name} edge ${e.from}->${e.to} carries reason "${e.reason}" but "${e.to}" is not a guarded target`);
    } else if (guards[e.to] !== e.reason) {
      errors.push(`${LIFECYCLES_JSON}: ${name} edge ${e.from}->${e.to} carries reason "${e.reason}" but guard requires "${guards[e.to]}"`);
    }
  }
}

function compareEdgeMaps(name, mdMap, jsonMap, errors) {
  for (const [key, reason] of mdMap) {
    if (!jsonMap.has(key)) {
      errors.push(`${LIFECYCLES_MD}: ${name} edge ${key} is present in Markdown but not JSON`);
    } else if ((jsonMap.get(key) ?? null) !== (reason ?? null)) {
      errors.push(`${name} edge ${key} reason mismatch: Markdown ${JSON.stringify(reason)} vs JSON ${JSON.stringify(jsonMap.get(key))}`);
    }
  }
  for (const key of jsonMap.keys()) {
    if (!mdMap.has(key)) {
      errors.push(`${LIFECYCLES_JSON}: ${name} edge ${key} is present in JSON but not Markdown`);
    }
  }
}

function validateForbiddenEdges(authority, md, errors) {
  const lifecycles = authority.lifecycles;
  const jsonForbidden = new Map();
  for (const entry of authority.forbiddenCrossLifecycleEdges || []) {
    if (!entry || typeof entry.from !== "string" || typeof entry.to !== "string") {
      errors.push(`${LIFECYCLES_JSON}: forbidden edge entry is malformed: ${JSON.stringify(entry)}`);
      continue;
    }
    for (const side of [entry.from, entry.to]) {
      const [lc, state] = side.split(":");
      if (!lc || !state || !lifecycles[lc]) {
        errors.push(`${LIFECYCLES_JSON}: forbidden edge "${side}" references unknown lifecycle`);
      } else if (!Array.isArray(lifecycles[lc].states)) {
        // Present-but-malformed lifecycle (key exists, `states` missing/non-array):
        // push a clean error instead of throwing a TypeError on `.includes`.
        errors.push(`${LIFECYCLES_JSON}: forbidden edge "${side}" references lifecycle "${lc}" with a missing or malformed state set`);
      } else if (!lifecycles[lc].states.includes(state)) {
        errors.push(`${LIFECYCLES_JSON}: forbidden edge "${side}" references unknown state in lifecycle "${lc}"`);
      }
    }
    const fromLc = entry.from.split(":")[0];
    const toLc = entry.to.split(":")[0];
    if (fromLc && toLc && fromLc === toLc) {
      errors.push(`${LIFECYCLES_JSON}: forbidden edge ${entry.from}->${entry.to} is not cross-lifecycle`);
    }
    jsonForbidden.set(edgeKey(entry.from, entry.to), true);
  }

  // Markdown parity for the forbidden table.
  const body = sectionBody(md, FORBIDDEN_TABLE_HEADING);
  const table = extractTransitionTable(body);
  if (!table) {
    errors.push(`${LIFECYCLES_MD}: forbidden cross-lifecycle transition table is missing`);
    return;
  }
  const mdForbidden = new Map();
  for (const cells of table.rows) {
    if (cells.length !== 2) continue;
    const from = parseNamespacedCell(cells[0]);
    const to = parseNamespacedCell(cells[1]);
    if (!from || !to) {
      errors.push(`${LIFECYCLES_MD}: forbidden table row is unparseable: ${JSON.stringify(cells)}`);
      continue;
    }
    mdForbidden.set(edgeKey(from, to), true);
  }
  for (const key of mdForbidden.keys()) {
    if (!jsonForbidden.has(key)) {
      errors.push(`${LIFECYCLES_MD}: forbidden edge ${key} is present in Markdown but not JSON`);
    }
  }
  for (const key of jsonForbidden.keys()) {
    if (!mdForbidden.has(key)) {
      errors.push(`${LIFECYCLES_JSON}: forbidden edge ${key} is present in JSON but not Markdown`);
    }
  }
}

/**
 * Read a required file and confirm each literal fragment is present. Missing
 * file → a single `missing` error (via readOrError); present-but-incomplete →
 * one error per absent fragment. This is the presence gate; the structured
 * authority validation below is the real semantic contract.
 */
async function requireFile(root, relPath, fragments, errors) {
  const content = await readOrError(root, relPath, errors);
  if (content == null) return null;
  for (const fragment of fragments) {
    if (!content.includes(fragment)) {
      errors.push(`${relPath}: missing required fragment ${JSON.stringify(fragment)}`);
    }
  }
  return content;
}

/**
 * Extract the first Markdown table from a section body as
 * { header: string[], rows: string[][] }. A table is a header line, a
 * separator row, then data rows. Returns null when no table is present.
 */
function extractTable(body) {
  if (body == null) return null;
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!isTableLine(lines[i])) continue;
    const header = splitRow(lines[i]);
    const j = i + 1;
    if (j < lines.length && isTableLine(lines[j]) && isSeparatorRow(splitRow(lines[j]))) {
      const rows = [];
      for (let k = j + 1; k < lines.length && isTableLine(lines[k]); k += 1) {
        rows.push(splitRow(lines[k]));
      }
      return { header, rows };
    }
  }
  return null;
}

/**
 * Split prose into sentences, newline-first so Markdown table rows never merge
 * with surrounding prose. Used by the negation-scanned invariants.
 */
function splitSentences(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    for (const piece of line.split(/(?<=[.!?])\s+/)) {
      const t = piece.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/**
 * Require that `needle` appears at least once and that every sentence mentioning
 * it carries a negation. This is what makes the invariant structural: dropping
 * the sentence fails (absence), and adding an affirmative claim fails (a mention
 * without negation) even when the negated invariant is still present.
 */
function requireNegatedMention(text, needle, label, errors) {
  const lowerNeedle = needle.toLowerCase();
  const hits = splitSentences(text).filter((s) => s.toLowerCase().includes(lowerNeedle));
  if (hits.length === 0) {
    errors.push(`${AUTHORITY_MD}: ${label} (no sentence mentions ${JSON.stringify(needle)})`);
    return;
  }
  for (const s of hits) {
    if (!NEGATION_RE.test(s)) {
      errors.push(`${AUTHORITY_MD}: ${label} (asserted without negation: ${JSON.stringify(s)})`);
    }
  }
}

/** Validate the authority matrix table row-by-row against the locked rows. */
function validateAuthorityMatrix(md, errors) {
  const body = sectionBody(md, AUTHORITY_MATRIX_HEADING);
  if (body == null) {
    errors.push(`${AUTHORITY_MD}: missing section ${JSON.stringify(AUTHORITY_MATRIX_HEADING)}`);
    return;
  }
  const table = extractTable(body);
  if (!table) {
    errors.push(`${AUTHORITY_MD}: authority matrix section has no Markdown table`);
    return;
  }
  if (
    table.header.length !== AUTHORITY_MATRIX_HEADER.length ||
    !AUTHORITY_MATRIX_HEADER.every((h, i) => table.header[i] === h)
  ) {
    errors.push(
      `${AUTHORITY_MD}: authority matrix header must be ${JSON.stringify(AUTHORITY_MATRIX_HEADER)}, found ${JSON.stringify(table.header)}`,
    );
  }
  const byState = new Map();
  for (const cells of table.rows) {
    if (cells.length === 3) byState.set(cells[0], { authority: cells[1], worker: cells[2] });
  }
  for (const row of EXPECTED_AUTHORITY_ROWS) {
    const got = byState.get(row.state);
    if (!got) {
      errors.push(`${AUTHORITY_MD}: authority matrix is missing the required row for state ${JSON.stringify(row.state)}`);
      continue;
    }
    if (got.authority !== row.authority) {
      errors.push(
        `${AUTHORITY_MD}: authority matrix row ${JSON.stringify(row.state)} must name authority ${JSON.stringify(row.authority)}, found ${JSON.stringify(got.authority)}`,
      );
    }
    if (got.worker !== row.worker) {
      errors.push(
        `${AUTHORITY_MD}: authority matrix row ${JSON.stringify(row.state)} must state worker behavior ${JSON.stringify(row.worker)}, found ${JSON.stringify(got.worker)}`,
      );
    }
  }
}

/** Validate the single-writer cutover: exactly one owner per run, atomic. */
function validateSingleWriter(md, errors) {
  const body = sectionBody(md, SINGLE_WRITER_HEADING);
  if (body == null) {
    errors.push(`${AUTHORITY_MD}: missing section ${JSON.stringify(SINGLE_WRITER_HEADING)}`);
    return;
  }
  const m = /ExecutionOwner\s*=\s*([^`\n]+)/.exec(body);
  if (!m) {
    errors.push(`${AUTHORITY_MD}: single-writer cutover does not declare "ExecutionOwner = legacy | distributed"`);
  } else {
    const owners = new Set(m[1].split("|").map((s) => s.trim()).filter(Boolean));
    const singleWriter = owners.size === 2 && owners.has("legacy") && owners.has("distributed");
    if (!singleWriter) {
      errors.push(
        `${AUTHORITY_MD}: single-writer cutover ExecutionOwner must be exactly "legacy | distributed" (one owner per run), found ${JSON.stringify(m[1].trim())}`,
      );
    }
  }
  if (!body.includes("selected atomically")) {
    errors.push(`${AUTHORITY_MD}: single-writer cutover is missing the atomic single-owner selection rule ("selected atomically")`);
  }
  if (!body.includes("never silently hands an active run to the other owner")) {
    errors.push(`${AUTHORITY_MD}: single-writer cutover is missing the rollback rule ("never silently hands an active run to the other owner")`);
  }
}

/** Validate the late/orphan-output quarantine: no stale commit, no auto-promote. */
function validateLateOutput(md, errors) {
  const body = sectionBody(md, LATE_OUTPUT_HEADING);
  if (body == null) {
    errors.push(`${AUTHORITY_MD}: missing section ${JSON.stringify(LATE_OUTPUT_HEADING)}`);
    return;
  }
  requireNegatedMention(
    body,
    "authoritative state",
    "late and orphan output: expired or replaced attempts must not update authoritative state",
    errors,
  );
  requireNegatedMention(
    body,
    "auto-applied",
    "late and orphan output: quarantined late output must never be auto-applied",
    errors,
  );
  if (!body.includes("quarantine prefix")) {
    errors.push(`${AUTHORITY_MD}: late and orphan output must route late results only to a "quarantine prefix"`);
  }
}

/** Orchestrate the FND-002 authority contract validation. */
async function validateAuthority(root, errors) {
  const content = await requireFile(root, AUTHORITY_MD, AUTHORITY_REQUIRED_FRAGMENTS, errors);
  if (content == null) return;
  validateAuthorityMatrix(content, errors);
  validateSingleWriter(content, errors);
  validateLateOutput(content, errors);
  // Doc-wide invariant: no AoA database is a peer replica.
  requireNegatedMention(content, "peer replica", "peer-replica invariant: no AoA database is a peer replica", errors);
}

/**
 * Parse the set of defined backlog ticket IDs from the program design's
 * `#### <ID> — ...` headings. This is the authoritative allow-list the
 * threat-model owner-ticket cross-reference validates against; an owner ticket
 * that is not a defined backlog ticket is rejected as invented.
 */
async function parseProgramTicketIds(root, errors) {
  const content = await readOrError(root, PROGRAM_DESIGN_MD, errors);
  if (content == null) return null;
  const ids = new Set();
  for (const line of content.split(/\r?\n/)) {
    const m = /^####\s+([A-Z][A-Z0-9]*-\d+)(?:\s|$)/.exec(line);
    if (m) ids.add(m[1]);
  }
  if (ids.size === 0) {
    errors.push(`${PROGRAM_DESIGN_MD}: parsed no backlog ticket IDs (expected "#### <ID> — ..." headings)`);
    return null;
  }
  return ids;
}

/** Does a crossing carry a release test (a REL-* owner or a releaseTest field)? */
function crossingHasReleaseTest(c) {
  const relOwner = Array.isArray(c.ownerTickets)
    && c.ownerTickets.some((t) => typeof t === "string" && REL_OWNER_RE.test(t));
  const releaseField = typeof c.releaseTest === "string" && c.releaseTest.trim() !== "";
  return relOwner || releaseField;
}

/**
 * Validate the threat-controls JSON crossing objects: exact required fields,
 * non-empty string values, unique stable IDs, known severity/lane values,
 * non-empty owner-ticket arrays whose IDs all exist in the program backlog, and
 * a release test for every Critical/High crossing. Returns the set of JSON
 * crossing IDs (for Markdown parity) or null when the array is unusable.
 */
function validateThreatCrossings(crossings, validTicketIds, errors) {
  const jsonIds = new Set();
  for (let idx = 0; idx < crossings.length; idx += 1) {
    const c = crossings[idx];
    if (c == null || typeof c !== "object" || Array.isArray(c)) {
      errors.push(`${THREAT_CONTROLS_JSON}: crossing at index ${idx} is not an object`);
      continue;
    }
    const label = typeof c.id === "string" && c.id ? c.id : `index ${idx}`;

    // Exact required-field presence.
    for (const field of THREAT_CROSSING_REQUIRED_FIELDS) {
      if (!(field in c)) {
        errors.push(`${THREAT_CONTROLS_JSON}: crossing ${label} is missing required field "${field}"`);
      }
    }

    // Stable unique ID.
    if (typeof c.id !== "string" || c.id.trim() === "") {
      errors.push(`${THREAT_CONTROLS_JSON}: crossing ${label} has an empty or non-string "id"`);
    } else {
      if (jsonIds.has(c.id)) {
        errors.push(`${THREAT_CONTROLS_JSON}: duplicate crossing id "${c.id}"`);
      }
      jsonIds.add(c.id);
    }

    // Every required field except ownerTickets must be a non-empty string.
    for (const field of THREAT_CROSSING_REQUIRED_FIELDS) {
      if (field === "ownerTickets") continue;
      if (field in c && (typeof c[field] !== "string" || c[field].trim() === "")) {
        errors.push(`${THREAT_CONTROLS_JSON}: crossing ${label} field "${field}" must be a non-empty string`);
      }
    }

    // Known enumerations.
    if (typeof c.severity === "string" && !THREAT_KNOWN_SEVERITIES.has(c.severity)) {
      errors.push(`${THREAT_CONTROLS_JSON}: crossing ${label} has unknown severity "${c.severity}"`);
    }
    if (typeof c.verificationLane === "string" && !THREAT_KNOWN_LANES.has(c.verificationLane)) {
      errors.push(`${THREAT_CONTROLS_JSON}: crossing ${label} has unknown verificationLane "${c.verificationLane}"`);
    }

    // Non-empty owner-ticket array cross-referenced against the backlog.
    if (!Array.isArray(c.ownerTickets) || c.ownerTickets.length === 0) {
      errors.push(`${THREAT_CONTROLS_JSON}: crossing ${label} must have a non-empty "ownerTickets" array`);
    } else if (validTicketIds != null) {
      for (const t of c.ownerTickets) {
        if (typeof t !== "string" || !validTicketIds.has(t)) {
          errors.push(`${THREAT_CONTROLS_JSON}: crossing ${label} references unknown owner ticket ${JSON.stringify(t)} (not defined in ${PROGRAM_DESIGN_MD})`);
        }
      }
    }

    // Release test for Critical/High.
    if (typeof c.severity === "string" && THREAT_RELEASE_SEVERITIES.has(c.severity) && !crossingHasReleaseTest(c)) {
      errors.push(`${THREAT_CONTROLS_JSON}: crossing ${label} is ${c.severity} but has no release test (no REL-* owner ticket and no non-empty "releaseTest" field)`);
    }
  }
  return jsonIds;
}

/**
 * Compare the complete JSON crossing ID set and every rendered field to the
 * Markdown register table (exact set parity in both directions, including
 * count, plus per-ID threat/severity/control/verification/owner parity). This
 * validates every control ID, not just the first/last.
 */
function validateThreatRegisterParity(md, crossings, jsonIds, errors) {
  const body = sectionBody(md, THREAT_REGISTER_HEADING);
  if (body == null) {
    errors.push(`${THREAT_MODEL_MD}: missing section ${JSON.stringify(THREAT_REGISTER_HEADING)}`);
    return;
  }
  const table = extractTable(body);
  if (!table) {
    errors.push(`${THREAT_MODEL_MD}: threat-and-control register has no Markdown table`);
    return;
  }
  if (
    table.header.length !== THREAT_REGISTER_HEADER.length ||
    !THREAT_REGISTER_HEADER.every((h, i) => table.header[i] === h)
  ) {
    errors.push(
      `${THREAT_MODEL_MD}: register header must be ${JSON.stringify(THREAT_REGISTER_HEADER)}, found ${JSON.stringify(table.header)}`,
    );
  }

  const mdMap = new Map();
  for (const cells of table.rows) {
    if (cells.length !== 6) {
      errors.push(`${THREAT_MODEL_MD}: register row is not six columns: ${JSON.stringify(cells)}`);
      continue;
    }
    const id = cells[0];
    if (mdMap.has(id)) {
      errors.push(`${THREAT_MODEL_MD}: duplicate register row for id "${id}"`);
    }
    mdMap.set(id, {
      threat: cells[1],
      severity: cells[2],
      control: cells[3],
      verification: cells[4],
      owners: cells[5].match(TICKET_ID_RE) || [],
    });
  }
  const mdIds = new Set(mdMap.keys());

  // Exact set parity (count included: any extra on either side is an error).
  for (const id of jsonIds) {
    if (!mdIds.has(id)) {
      errors.push(`${THREAT_MODEL_MD}: crossing id "${id}" is present in JSON but not the Markdown register`);
    }
  }
  for (const id of mdIds) {
    if (!jsonIds.has(id)) {
      errors.push(`${THREAT_CONTROLS_JSON}: register id "${id}" is present in the Markdown register but not JSON`);
    }
  }

  // Per-ID rendered-field parity for every crossing present on both sides.
  const byId = new Map();
  for (const c of crossings) {
    if (typeof c.id === "string") byId.set(c.id, c);
  }
  for (const [id, row] of mdMap) {
    const c = byId.get(id);
    if (!c) continue; // already reported as an extra Markdown row
    if (typeof c.threat === "string" && c.threat !== row.threat) {
      errors.push(`${THREAT_MODEL_MD}: register threat for "${id}" is ${JSON.stringify(row.threat)} but JSON is ${JSON.stringify(c.threat)}`);
    }
    if (typeof c.severity === "string" && c.severity !== row.severity) {
      errors.push(`${THREAT_MODEL_MD}: register severity for "${id}" is ${JSON.stringify(row.severity)} but JSON is ${JSON.stringify(c.severity)}`);
    }
    if (typeof c.control === "string" && c.control !== row.control) {
      errors.push(`${THREAT_MODEL_MD}: register control for "${id}" is ${JSON.stringify(row.control)} but JSON is ${JSON.stringify(c.control)}`);
    }
    if (typeof c.verification === "string" && c.verification !== row.verification) {
      errors.push(`${THREAT_MODEL_MD}: register verification for "${id}" is ${JSON.stringify(row.verification)} but JSON is ${JSON.stringify(c.verification)}`);
    }
    const jsonOwners = Array.isArray(c.ownerTickets) ? c.ownerTickets.filter((t) => typeof t === "string") : [];
    const mdOwnerSet = new Set(row.owners);
    const jsonOwnerSet = new Set(jsonOwners);
    const ownersEqual = mdOwnerSet.size === jsonOwnerSet.size && [...jsonOwnerSet].every((t) => mdOwnerSet.has(t));
    if (!ownersEqual) {
      errors.push(`${THREAT_MODEL_MD}: register owners for "${id}" ${JSON.stringify([...mdOwnerSet])} do not match JSON ownerTickets ${JSON.stringify(jsonOwners)}`);
    }
  }
}

/** Orchestrate the FND-003 threat-model + control-ownership contract. */
async function validateThreatModel(root, errors) {
  const md = await requireFile(root, THREAT_MODEL_MD, THREAT_MODEL_FRAGMENTS, errors);
  const rawJson = await readOrError(root, THREAT_CONTROLS_JSON, errors);
  const validTicketIds = await parseProgramTicketIds(root, errors);

  let controls = null;
  if (rawJson != null) {
    try {
      controls = JSON.parse(rawJson);
    } catch (err) {
      errors.push(`${THREAT_CONTROLS_JSON}: invalid JSON (${err.message})`);
    }
  }

  let crossings = null;
  if (controls != null) {
    if (typeof controls.version !== "number") {
      errors.push(`${THREAT_CONTROLS_JSON}: missing numeric "version"`);
    }
    if (!Array.isArray(controls.crossings)) {
      errors.push(`${THREAT_CONTROLS_JSON}: missing array "crossings"`);
    } else if (controls.crossings.length === 0) {
      errors.push(`${THREAT_CONTROLS_JSON}: "crossings" array is empty`);
    } else {
      crossings = controls.crossings;
    }
  }

  let jsonIds = null;
  if (crossings != null) {
    jsonIds = validateThreatCrossings(crossings, validTicketIds, errors);
  }

  if (md != null && crossings != null && jsonIds != null) {
    validateThreatRegisterParity(md, crossings, jsonIds, errors);
  }

  // Residual-risk release exclusions.
  if (md != null) {
    const body = sectionBody(md, RESIDUAL_HEADING);
    if (body == null) {
      errors.push(`${THREAT_MODEL_MD}: missing section ${JSON.stringify(RESIDUAL_HEADING)}`);
    } else {
      for (const excl of RESIDUAL_EXCLUSIONS) {
        if (!body.includes(excl)) {
          errors.push(`${THREAT_MODEL_MD}: residual risks section must explicitly exclude ${JSON.stringify(excl)}`);
        }
      }
    }
  }
}

export async function runCheck(root) {
  const errors = [];

  const rawJson = await readOrError(root, LIFECYCLES_JSON, errors);
  const md = await readOrError(root, LIFECYCLES_MD, errors);
  const decisions = await readOrError(root, DECISIONS_MD, errors);

  // Markdown headings + workload tokens (only when the file loaded).
  if (md != null) {
    const headingLines = new Set(
      md
        .split(/\r?\n/)
        .filter((l) => /^#{1,6}\s/.test(l))
        .map((l) => l.trim()),
    );
    for (const heading of REQUIRED_MD_HEADINGS) {
      if (!headingLines.has(heading)) {
        errors.push(`${LIFECYCLES_MD}: missing heading ${JSON.stringify(heading)}`);
      }
    }
    for (const token of REQUIRED_WORKLOAD_TOKENS) {
      if (!md.includes(token)) {
        errors.push(`${LIFECYCLES_MD}: missing workload token ${JSON.stringify(token)}`);
      }
    }
  }

  // Decision #121 record.
  if (decisions != null) {
    if (!decisions.includes(DECISION_121_HEADING)) {
      errors.push(`${DECISIONS_MD}: missing ${JSON.stringify(DECISION_121_HEADING)}`);
    }
    if (!decisions.includes("distributed-execution-lifecycles.md")) {
      errors.push(`${DECISIONS_MD}: missing reference to "distributed-execution-lifecycles.md"`);
    }
    if (!decisions.includes("distributed-execution-authority.md")) {
      errors.push(`${DECISIONS_MD}: missing reference to "distributed-execution-authority.md"`);
    }
    if (!decisions.includes("distributed-execution-threat-model.md")) {
      errors.push(`${DECISIONS_MD}: missing reference to "distributed-execution-threat-model.md"`);
    }
  }

  // FND-002 authority contract (independent of the lifecycle JSON/Markdown).
  await validateAuthority(root, errors);

  // FND-003 threat model + control ownership contract.
  await validateThreatModel(root, errors);

  // JSON authority.
  if (rawJson != null) {
    let authority;
    try {
      authority = JSON.parse(rawJson);
    } catch (err) {
      errors.push(`${LIFECYCLES_JSON}: invalid JSON (${err.message})`);
      authority = null;
    }

    if (authority != null) {
      if (typeof authority.version !== "number") {
        errors.push(`${LIFECYCLES_JSON}: missing numeric "version"`);
      }
      if (!Array.isArray(authority.forbiddenCrossLifecycleEdges)) {
        errors.push(`${LIFECYCLES_JSON}: missing array "forbiddenCrossLifecycleEdges"`);
      }
      if (!authority.lifecycles || typeof authority.lifecycles !== "object") {
        errors.push(`${LIFECYCLES_JSON}: missing object "lifecycles"`);
      } else {
        for (const name of REQUIRED_LIFECYCLES) {
          const lc = authority.lifecycles[name];
          if (!lc) {
            errors.push(`${LIFECYCLES_JSON}: missing lifecycle "${name}"`);
            continue;
          }
          let structurallyOk = true;
          for (const field of REQUIRED_LIFECYCLE_FIELDS) {
            if (!(field in lc)) {
              errors.push(`${LIFECYCLES_JSON}: lifecycle "${name}" is missing required field "${field}"`);
              structurallyOk = false;
            }
          }
          if (!Array.isArray(lc.states) || !Array.isArray(lc.allowed)
            || !Array.isArray(lc.initial) || !Array.isArray(lc.terminal)) {
            errors.push(`${LIFECYCLES_JSON}: lifecycle "${name}" has non-array states/allowed/initial/terminal`);
            structurallyOk = false;
          }
          if (!structurallyOk) continue;

          validateLifecycleGraph(name, lc, errors);

          // JSON<->Markdown table parity.
          if (md != null) {
            const body = sectionBody(md, lc.markdownHeading);
            if (body == null) {
              errors.push(`${LIFECYCLES_MD}: missing section for ${JSON.stringify(lc.markdownHeading)}`);
            } else {
              const table = extractTransitionTable(body);
              if (!table) {
                errors.push(`${LIFECYCLES_MD}: ${name} lifecycle section has no From/To transition table`);
              } else {
                const mdMap = markdownEdgeMap(table, name, errors);
                const jsonMap = jsonEdgeMap(lc);
                compareEdgeMaps(name, mdMap, jsonMap, errors);
              }
            }
          }
        }

        if (Array.isArray(authority.forbiddenCrossLifecycleEdges) && md != null) {
          validateForbiddenEdges(authority, md, errors);
        }
      }
    }
  }

  return { errors };
}

function resolveRoot(argv) {
  const i = argv.indexOf("--root");
  if (i !== -1 && argv[i + 1]) {
    return path.resolve(argv[i + 1]);
  }
  return process.cwd();
}

async function main() {
  const root = resolveRoot(process.argv.slice(2));
  const { errors } = await runCheck(root);
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log("distributed execution foundation: PASS");
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
