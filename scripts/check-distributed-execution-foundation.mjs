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

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

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
// E0-F004: `threat`/`control`/`verification` are rendered into the Markdown
// register and value-compared in per-ID parity, so they are required here too —
// otherwise deleting one from a JSON crossing escaped detection (value-drift was
// caught, field-deletion was not). All 30 crossings already carry them.
const THREAT_CROSSING_REQUIRED_FIELDS = [
  "id",
  "threat",
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
  "control",
  "verification",
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

// --- FND-004: golden-journey + failure fixture corpus ------------------------
//
// This layer adds three interlocking contracts on top of FND-001..003:
//   (a) a strict JSON Schema draft 2020-12 document `schema-v1.json` whose
//       meta-shape (dialect, $id, keyword allowlist, closed-object rules,
//       $comment convention, required $defs, resolvable $refs) is validated by a
//       dependency-free meta-validator — an unknown/custom keyword fails E0;
//   (b) a dependency-free interpreter for the JSON Schema subset the schema uses,
//       validating each of the nine fixtures (types, format/pattern, enum,
//       uniqueItems, numeric + `aoa:utf8-max-bytes` bounds, closed objects, and
//       the task_run source discriminant) against those exact bytes; and
//   (c) the locked RFC 8785 canonical-JSON subset + SHA-256 `eventDigest`
//       contract that PRT-004 reproduces byte-for-byte, plus the semantic
//       cross-references (identity/tenant consistency, digest recompute, canary
//       non-leakage) that JSON Schema cannot express.

const GJ_DIR = "tests/fixtures/distributed-execution";
const GJ_SCHEMA = `${GJ_DIR}/schema-v1.json`;
const GJ_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";
const GJ_SCHEMA_ID = "https://aoa.dev/contracts/distributed-execution/golden-journey-v1.schema.json";

const GJ_FIXTURES = [
  "batch-success.json",
  "batch-cancel-during-execution.json",
  "browser-approval-download.json",
  "browser-denied-egress.json",
  "service-restart-checkpoint.json",
  "service-budget-stop.json",
  "service-provider-pause-resume.json",
  "late-output-quarantine.json",
  "plaintext-secret-in-argv-rejected.json",
];

const GJ_ALLOWED_WORKLOADS = new Set(["batch", "browser_session", "service"]);
// terminalState values used by the corpus. Every value here is also a declared
// state in the FND-001 lifecycle model (cross-checked at runtime).
const GJ_TERMINAL_STATES = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "stopped",
  "healthy",
  "expired",
]);

// The exact JSON Schema 2020-12 keyword allowlist this contract permits. E1
// compiles the same bytes in Ajv 2020-12 strict mode; a keyword outside this set
// (a custom/unknown keyword) fails E0 here before it can reach E1.
const JSON_SCHEMA_KEYWORDS = new Set([
  "$schema", "$id", "$ref", "$defs", "$comment", "title", "description",
  "type", "const", "enum", "required",
  "properties", "additionalProperties", "unevaluatedProperties",
  "items", "minItems", "maxItems", "uniqueItems",
  "minimum", "maximum", "minLength", "maxLength", "pattern", "format",
  "allOf", "anyOf", "oneOf", "not", "if", "then", "else",
]);

// $defs that must be present for the contract to be usable by E1/PRT-004.
const GJ_REQUIRED_DEFS = [
  "Organization", "Company", "Requester", "Executor", "Placement", "InputBase",
  "AttemptRef", "Identity", "Source", "Step", "FailureInjection", "Event",
  "EventPayload", "Metrics", "Cost", "Timing", "Cleanup", "Control", "Canary",
  "Expected",
];

const RFC3339_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

// --- (c1) RFC 8785 canonical-JSON subset + SHA-256 eventDigest ---------------
//
// The locked v1 subset: null, booleans, strings, arrays, plain objects, and
// finite safe integers. Floats, unsafe integers, lone surrogates, and any other
// value are rejected. Object keys sort by UTF-16 code units; string/number
// serialization follows RFC 8785 (ECMAScript JSON string escaping; integers
// print with no exponent, no leading zeros, and -0 normalizes to 0). This is the
// single source of truth for `eventDigest`; PRT-004 imports or byte-for-byte
// reproduces it.

class CanonicalizationError extends Error {}

/** RFC 8785 string serialization (rejects lone surrogates). */
function canonicalizeString(str) {
  let out = '"';
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) {
        throw new CanonicalizationError("lone high surrogate in string");
      }
      out += str[i] + str[i + 1];
      i += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new CanonicalizationError("lone low surrogate in string");
    }
    if (code === 0x22) out += '\\"';
    else if (code === 0x5c) out += "\\\\";
    else if (code === 0x08) out += "\\b";
    else if (code === 0x09) out += "\\t";
    else if (code === 0x0a) out += "\\n";
    else if (code === 0x0c) out += "\\f";
    else if (code === 0x0d) out += "\\r";
    else if (code < 0x20) out += "\\u" + code.toString(16).padStart(4, "0");
    else out += str[i];
  }
  return out + '"';
}

/** RFC 8785 number serialization for the integer-only v1 subset. */
function canonicalizeNumber(num) {
  if (!Number.isFinite(num)) {
    throw new CanonicalizationError("non-finite number is not allowed");
  }
  if (!Number.isInteger(num)) {
    throw new CanonicalizationError("float is not allowed in the v1 subset");
  }
  if (!Number.isSafeInteger(num)) {
    throw new CanonicalizationError("unsafe integer is not allowed");
  }
  if (Object.is(num, -0)) return "0";
  return String(num);
}

/** Canonicalize a parsed JSON value to its RFC 8785 (subset) string form. */
export function canonicalizeJson(value) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") return canonicalizeNumber(value);
  if (t === "string") return canonicalizeString(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalizeJson(v)).join(",") + "]";
  }
  if (t === "object") {
    // Sort keys by UTF-16 code units (JS default string comparison).
    const keys = Object.keys(value).sort();
    const members = keys.map(
      (k) => canonicalizeString(k) + ":" + canonicalizeJson(value[k]),
    );
    return "{" + members.join(",") + "}";
  }
  throw new CanonicalizationError(`unsupported value of type ${t}`);
}

/** SHA-256 (lowercase hex) over the UTF-8 canonical bytes of `event` minus `eventDigest`. */
export function computeEventDigest(event) {
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    throw new CanonicalizationError("event must be a plain object");
  }
  const { eventDigest, ...rest } = event;
  const canonical = canonicalizeJson(rest);
  return createHash("sha256").update(Buffer.from(canonical, "utf8")).digest("hex");
}

// --- (c2) strict JSON parse (rejects duplicate object keys) ------------------
//
// JSON.parse silently keeps the last value for a duplicated key; a fixture with
// duplicate semantic keys is ambiguous, so fixtures load through this parser.
export function parseJsonStrict(text) {
  let i = 0;
  const n = text.length;
  const isWs = (c) => c === " " || c === "\t" || c === "\n" || c === "\r";
  const skipWs = () => { while (i < n && isWs(text[i])) i += 1; };
  const fail = (msg) => { throw new SyntaxError(`${msg} at position ${i}`); };

  function parseString() {
    i += 1; // opening quote
    let s = "";
    for (;;) {
      if (i >= n) fail("unterminated string");
      const ch = text[i];
      if (ch === '"') { i += 1; break; }
      if (ch === "\\") {
        i += 1;
        const e = text[i];
        if (e === '"') s += '"';
        else if (e === "\\") s += "\\";
        else if (e === "/") s += "/";
        else if (e === "b") s += "\b";
        else if (e === "f") s += "\f";
        else if (e === "n") s += "\n";
        else if (e === "r") s += "\r";
        else if (e === "t") s += "\t";
        else if (e === "u") {
          const hex = text.slice(i + 1, i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("invalid \\u escape");
          s += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else fail("invalid escape");
        i += 1;
        continue;
      }
      if (ch.charCodeAt(0) < 0x20) fail("unescaped control character in string");
      s += ch;
      i += 1;
    }
    return s;
  }

  function parseNumber() {
    const start = i;
    if (text[i] === "-") i += 1;
    while (i < n && text[i] >= "0" && text[i] <= "9") i += 1;
    if (text[i] === ".") { i += 1; while (i < n && text[i] >= "0" && text[i] <= "9") i += 1; }
    if (text[i] === "e" || text[i] === "E") {
      i += 1;
      if (text[i] === "+" || text[i] === "-") i += 1;
      while (i < n && text[i] >= "0" && text[i] <= "9") i += 1;
    }
    const raw = text.slice(start, i);
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) fail("invalid number");
    return Number(raw);
  }

  function parseValue() {
    skipWs();
    const c = text[i];
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === '"') return parseString();
    if (c === "-" || (c >= "0" && c <= "9")) return parseNumber();
    if (text.startsWith("true", i)) { i += 4; return true; }
    if (text.startsWith("false", i)) { i += 5; return false; }
    if (text.startsWith("null", i)) { i += 4; return null; }
    fail("unexpected token");
    return undefined;
  }

  function parseObject() {
    i += 1; // {
    const obj = {};
    const seen = new Set();
    skipWs();
    if (text[i] === "}") { i += 1; return obj; }
    for (;;) {
      skipWs();
      if (text[i] !== '"') fail("expected object key");
      const key = parseString();
      if (seen.has(key)) throw new SyntaxError(`duplicate object key ${JSON.stringify(key)} at position ${i}`);
      seen.add(key);
      skipWs();
      if (text[i] !== ":") fail("expected ':'");
      i += 1;
      obj[key] = parseValue();
      skipWs();
      if (text[i] === ",") { i += 1; continue; }
      if (text[i] === "}") { i += 1; break; }
      fail("expected ',' or '}'");
    }
    return obj;
  }

  function parseArray() {
    i += 1; // [
    const arr = [];
    skipWs();
    if (text[i] === "]") { i += 1; return arr; }
    for (;;) {
      arr.push(parseValue());
      skipWs();
      if (text[i] === ",") { i += 1; continue; }
      if (text[i] === "]") { i += 1; break; }
      fail("expected ',' or ']'");
    }
    return arr;
  }

  skipWs();
  const value = parseValue();
  skipWs();
  if (i !== n) fail("trailing content after JSON value");
  return value;
}

// --- (a) JSON Schema meta-validator ------------------------------------------

const SUBSCHEMA_KEYS = [
  "additionalProperties", "unevaluatedProperties", "items", "if", "then",
  "else", "not", "contains", "propertyNames",
];
const SUBSCHEMA_MAP_KEYS = ["properties", "$defs", "patternProperties", "dependentSchemas"];
const SUBSCHEMA_ARRAY_KEYS = ["allOf", "anyOf", "oneOf", "prefixItems"];

/** True only for schemas that declare `type: "object"` (an object schema that
 * must be closed). Matcher fragments that use bare `properties`/`required`
 * inside `if`/`anyOf` are conditional applicators, not object schemas. */
function declaresObjectType(node) {
  return node.type === "object"
    || (Array.isArray(node.type) && node.type.includes("object"));
}

function composesInPlace(node) {
  return "allOf" in node || "anyOf" in node || "oneOf" in node
    || "if" in node || "then" in node || "else" in node;
}

/** Recursively validate the schema meta-shape. */
function walkSchema(node, pathStr, defsNames, errors) {
  if (node === true || node === false) return;
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    errors.push(`${GJ_SCHEMA}: schema node at ${pathStr} must be an object or boolean`);
    return;
  }
  for (const key of Object.keys(node)) {
    if (!JSON_SCHEMA_KEYWORDS.has(key)) {
      errors.push(`${GJ_SCHEMA}: unknown/custom schema keyword "${key}" at ${pathStr}`);
    }
  }
  if ("$comment" in node) {
    const c = node.$comment;
    if (typeof c !== "string" || !/^aoa:utf8-max-bytes=[1-9][0-9]*$/.test(c)) {
      errors.push(`${GJ_SCHEMA}: $comment ${JSON.stringify(c)} at ${pathStr} must match "aoa:utf8-max-bytes=<positive integer>"`);
    }
  }
  if ("$ref" in node) {
    const ref = node.$ref;
    const m = typeof ref === "string" ? /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(ref) : null;
    if (!m) {
      errors.push(`${GJ_SCHEMA}: $ref ${JSON.stringify(ref)} at ${pathStr} must be a local #/$defs/<Name> reference`);
    } else if (!defsNames.has(m[1])) {
      errors.push(`${GJ_SCHEMA}: $ref ${JSON.stringify(ref)} at ${pathStr} does not resolve to a defined $def`);
    }
  }
  if (declaresObjectType(node) && node.additionalProperties !== false) {
    errors.push(`${GJ_SCHEMA}: object schema at ${pathStr} must set additionalProperties:false`);
  }
  if (declaresObjectType(node) && composesInPlace(node) && node.unevaluatedProperties !== false) {
    errors.push(`${GJ_SCHEMA}: composing object schema at ${pathStr} must also set unevaluatedProperties:false`);
  }
  for (const k of SUBSCHEMA_MAP_KEYS) {
    if (k in node && node[k] && typeof node[k] === "object") {
      for (const name of Object.keys(node[k])) {
        walkSchema(node[k][name], `${pathStr}/${k}/${name}`, defsNames, errors);
      }
    }
  }
  for (const k of SUBSCHEMA_KEYS) {
    if (k in node) walkSchema(node[k], `${pathStr}/${k}`, defsNames, errors);
  }
  for (const k of SUBSCHEMA_ARRAY_KEYS) {
    if (k in node && Array.isArray(node[k])) {
      node[k].forEach((s, idx) => walkSchema(s, `${pathStr}/${k}/${idx}`, defsNames, errors));
    }
  }
}

async function loadAndValidateSchema(root, errors) {
  const raw = await readOrError(root, GJ_SCHEMA, errors);
  if (raw == null) return null;
  let schema;
  try {
    schema = parseJsonStrict(raw);
  } catch (err) {
    errors.push(`${GJ_SCHEMA}: invalid JSON (${err.message})`);
    return null;
  }
  if (schema.$schema !== GJ_SCHEMA_DIALECT) {
    errors.push(`${GJ_SCHEMA}: $schema must be ${JSON.stringify(GJ_SCHEMA_DIALECT)}`);
  }
  if (schema.$id !== GJ_SCHEMA_ID) {
    errors.push(`${GJ_SCHEMA}: $id must be ${JSON.stringify(GJ_SCHEMA_ID)}`);
  }
  if (schema.type !== "object") {
    errors.push(`${GJ_SCHEMA}: root "type" must be "object"`);
  }
  if (!Array.isArray(schema.required) || schema.required.length === 0) {
    errors.push(`${GJ_SCHEMA}: root must declare a non-empty "required" array`);
  }
  const defs = schema.$defs && typeof schema.$defs === "object" ? schema.$defs : {};
  const defsNames = new Set(Object.keys(defs));
  for (const name of GJ_REQUIRED_DEFS) {
    if (!defsNames.has(name)) errors.push(`${GJ_SCHEMA}: missing required $def "${name}"`);
  }
  walkSchema(schema, "#", defsNames, errors);
  return schema;
}

// --- (b) JSON Schema (subset) instance validator -----------------------------

function derefSchema(schema, root) {
  let s = schema;
  let guard = 0;
  while (s && typeof s === "object" && "$ref" in s) {
    const m = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(s.$ref);
    if (!m) return s;
    s = root.$defs ? root.$defs[m[1]] : undefined;
    if (s === undefined) return {};
    guard += 1;
    if (guard > 50) return {};
  }
  return s;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && deepEqual(a[k], b[k]));
  }
  return false;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function matchesType(value, t) {
  switch (t) {
    case "string": return typeof value === "string";
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    case "array": return Array.isArray(value);
    case "object": return isPlainObject(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value) && Number.isSafeInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    default: return false;
  }
}

function schemaMatches(value, schema, root) {
  const scratch = [];
  validateInstance(value, schema, root, "#", scratch);
  return scratch.length === 0;
}

/** Property names an object schema (and its in-place applicators) declare. */
function collectDeclaredProps(schema, value, root, acc) {
  const s = derefSchema(schema, root);
  if (!s || typeof s !== "object") return acc;
  if (s.properties) for (const k of Object.keys(s.properties)) acc.add(k);
  if (Array.isArray(s.allOf)) for (const sub of s.allOf) collectDeclaredProps(sub, value, root, acc);
  if (s.if !== undefined) {
    if (schemaMatches(value, s.if, root)) {
      if (s.then !== undefined) collectDeclaredProps(s.then, value, root, acc);
    } else if (s.else !== undefined) {
      collectDeclaredProps(s.else, value, root, acc);
    }
  }
  return acc;
}

function validateObject(value, schema, root, pathStr, errors) {
  for (const r of schema.required || []) {
    if (!(r in value)) errors.push(`${pathStr}/${r} is required`);
  }
  if (schema.properties) {
    for (const [pname, psub] of Object.entries(schema.properties)) {
      if (pname in value) {
        if (psub === false) errors.push(`${pathStr}/${pname} is not allowed here`);
        else validateInstance(value[pname], psub, root, `${pathStr}/${pname}`, errors);
      }
    }
  }
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) validateInstance(value, sub, root, pathStr, errors);
  }
  if (schema.if !== undefined) {
    if (schemaMatches(value, schema.if, root)) {
      if (schema.then !== undefined) validateInstance(value, schema.then, root, pathStr, errors);
    } else if (schema.else !== undefined) {
      validateInstance(value, schema.else, root, pathStr, errors);
    }
  }
  if (schema.not !== undefined && schemaMatches(value, schema.not, root)) {
    errors.push(`${pathStr} must not match the forbidden subschema`);
  }
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((sub) => schemaMatches(value, sub, root))) {
    errors.push(`${pathStr} does not match any anyOf branch`);
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((sub) => schemaMatches(value, sub, root)).length;
    if (matches !== 1) errors.push(`${pathStr} must match exactly one oneOf branch (matched ${matches})`);
  }
  if (schema.additionalProperties === false || schema.unevaluatedProperties === false) {
    const allowed = collectDeclaredProps(schema, value, root, new Set());
    for (const k of Object.keys(value)) {
      if (!allowed.has(k)) errors.push(`${pathStr}/${k} is not an allowed property`);
    }
  }
}

// Validate a value against a (subset) schema. Signature: (value, schema, root,
// pathStr, errors). Type-specific keywords are gated on the runtime type so a
// nullable `["string","null"]` value never triggers string/number checks.
function validateInstance(value, schema, root, pathStr, errors) {
  const s = derefSchema(schema, root);
  if (s === true) return;
  if (s === false) { errors.push(`${pathStr} is not allowed`); return; }
  if (!s || typeof s !== "object") return;

  if ("type" in s) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${pathStr} must be of type ${JSON.stringify(s.type)}`);
      return;
    }
  }
  if ("const" in s && !deepEqual(value, s.const)) {
    errors.push(`${pathStr} must equal ${JSON.stringify(s.const)}`);
  }
  if ("enum" in s && !s.enum.some((e) => deepEqual(value, e))) {
    errors.push(`${pathStr} must be one of ${JSON.stringify(s.enum)}`);
  }

  if (typeof value === "string") {
    if ("minLength" in s && value.length < s.minLength) errors.push(`${pathStr} is shorter than minLength ${s.minLength}`);
    if ("maxLength" in s && value.length > s.maxLength) errors.push(`${pathStr} is longer than maxLength ${s.maxLength}`);
    if ("pattern" in s && !new RegExp(s.pattern, "u").test(value)) errors.push(`${pathStr} does not match pattern ${JSON.stringify(s.pattern)}`);
    if (s.format === "date-time" && !RFC3339_DATE_TIME.test(value)) errors.push(`${pathStr} is not an RFC3339 date-time`);
    if ("$comment" in s) {
      const m = /^aoa:utf8-max-bytes=([1-9][0-9]*)$/.exec(s.$comment);
      if (m && Buffer.byteLength(value, "utf8") > Number(m[1])) {
        errors.push(`${pathStr} exceeds ${m[1]} UTF-8 bytes`);
      }
    }
  }
  if (typeof value === "number") {
    if ("minimum" in s && value < s.minimum) errors.push(`${pathStr} is below minimum ${s.minimum}`);
    if ("maximum" in s && value > s.maximum) errors.push(`${pathStr} is above maximum ${s.maximum}`);
  }
  if (Array.isArray(value)) {
    if ("minItems" in s && value.length < s.minItems) errors.push(`${pathStr} has fewer than minItems ${s.minItems}`);
    if ("maxItems" in s && value.length > s.maxItems) errors.push(`${pathStr} has more than maxItems ${s.maxItems}`);
    if (s.uniqueItems === true) {
      const seen = new Set();
      for (const el of value) {
        let key;
        try { key = canonicalizeJson(el); } catch { key = JSON.stringify(el); }
        if (seen.has(key)) { errors.push(`${pathStr} must have unique items`); break; }
        seen.add(key);
      }
    }
    if (s.items) value.forEach((el, idx) => validateInstance(el, s.items, root, `${pathStr}/${idx}`, errors));
  }
  if (isPlainObject(value)) validateObject(value, s, root, pathStr, errors);
}

// --- (c3) fixture semantic validation ----------------------------------------

/** Stable tuple key for an (attempt, leaseId, fenceToken) triple. */
function attemptTupleKey(attempt, workerId, leaseId, fenceToken) {
  const worker = workerId === null || workerId === undefined ? "<null>" : String(workerId);
  const lease = leaseId === null || leaseId === undefined ? "<null>" : String(leaseId);
  const fence = fenceToken === null || fenceToken === undefined ? "<null>" : String(fenceToken);
  return attempt + " | " + worker + " | " + lease + " | " + fence;
}

function validateFixtureSemantics(rel, name, fixture, lifecycleStates, errors) {
  const base = name.replace(/\.json$/, "");

  // Plan Step-1 baseline checks (kept verbatim so their causes are stable).
  if (fixture.schemaVersion !== 1) errors.push(`${rel}: schemaVersion must be 1`);
  if (fixture.id !== base) errors.push(`${rel}: id must match filename`);
  if (!GJ_ALLOWED_WORKLOADS.has(fixture.workloadType)) errors.push(`${rel}: invalid workloadType`);
  if (!Array.isArray(fixture.steps) || fixture.steps.length === 0) errors.push(`${rel}: steps must be non-empty`);
  if (!fixture.expected || typeof fixture.expected.terminalState !== "string") {
    errors.push(`${rel}: expected.terminalState is required`);
  } else {
    if (!GJ_TERMINAL_STATES.has(fixture.expected.terminalState)) {
      errors.push(`${rel}: expected.terminalState ${JSON.stringify(fixture.expected.terminalState)} is not an allowed terminal state`);
    } else if (lifecycleStates && !lifecycleStates.has(fixture.expected.terminalState)) {
      errors.push(`${rel}: expected.terminalState ${JSON.stringify(fixture.expected.terminalState)} is not a declared FND-001 lifecycle state`);
    }
  }
  if (!fixture.expected || !Array.isArray(fixture.expected.auditActions) || fixture.expected.auditActions.length === 0) {
    errors.push(`${rel}: expected.auditActions must be non-empty`);
  }
  if (!fixture.expected || !Array.isArray(fixture.expected.forbiddenEffects) || fixture.expected.forbiddenEffects.length === 0) {
    errors.push(`${rel}: expected.forbiddenEffects must be non-empty`);
  }

  const org = fixture.organization;
  const company = fixture.company;
  const identity = fixture.identity;

  // Cross-tenant consistency: company belongs to the organization.
  if (isPlainObject(org) && isPlainObject(company) && company.organizationId !== org.id) {
    errors.push(`${rel}: company.organizationId ${JSON.stringify(company.organizationId)} does not match organization.id ${JSON.stringify(org.id)}`);
  }

  // Identity attempt-set: unique leases, strictly increasing attempt + fence.
  const attempts = identity && Array.isArray(identity.attempts) ? identity.attempts : [];
  const attemptKeys = new Set();
  const leaseIds = [];
  let prevAttempt = null;
  let prevFence = null;
  for (const a of attempts) {
    if (!isPlainObject(a)) continue;
    attemptKeys.add(attemptTupleKey(a.attempt, a.workerId, a.leaseId, a.fenceToken));
    if (a.leaseId !== null && a.leaseId !== undefined) leaseIds.push(a.leaseId);
    if (typeof a.attempt === "number") {
      if (prevAttempt !== null && !(a.attempt > prevAttempt)) errors.push(`${rel}: identity.attempts attempt numbers must strictly increase`);
      prevAttempt = a.attempt;
    }
    if (typeof a.fenceToken === "number") {
      if (prevFence !== null && !(a.fenceToken > prevFence)) errors.push(`${rel}: identity.attempts fenceToken must strictly increase across attempts`);
      prevFence = a.fenceToken;
    }
  }
  if (new Set(leaseIds).size !== leaseIds.length) errors.push(`${rel}: identity.attempts has a duplicate leaseId`);

  // Events: tenant + identity consistency, uniqueness, ordering, digest.
  const events = Array.isArray(fixture.expectedEvents) ? fixture.expectedEvents : [];
  if (events.length === 0) errors.push(`${rel}: expectedEvents must be non-empty`);
  const eventIds = new Set();
  let prevSeq = null;
  let prevAt = null;
  events.forEach((ev, idx) => {
    if (!isPlainObject(ev)) return;
    if (isPlainObject(org) && ev.organizationId !== org.id) {
      errors.push(`${rel}: event[${idx}] organizationId ${JSON.stringify(ev.organizationId)} does not match organization.id ${JSON.stringify(org.id)}`);
    }
    if (isPlainObject(company) && ev.companyId !== company.id) {
      errors.push(`${rel}: event[${idx}] companyId ${JSON.stringify(ev.companyId)} does not match company.id ${JSON.stringify(company.id)}`);
    }
    if (isPlainObject(identity)) {
      if (ev.jobId !== identity.jobId) {
        errors.push(`${rel}: event[${idx}] jobId ${JSON.stringify(ev.jobId)} does not match identity.jobId ${JSON.stringify(identity.jobId)}`);
      }
      // The (attempt, workerId, leaseId, fenceToken) tuple must exactly match one
      // declared identity attempt. Service restart/pause-resume and late-output
      // quarantine legitimately span replacement instances (a second attempt with
      // its own worker/lease/fence); every event still binds to a declared one.
      const key = attemptTupleKey(ev.attempt, ev.workerId, ev.leaseId, ev.fenceToken);
      if (!attemptKeys.has(key)) {
        errors.push(`${rel}: event[${idx}] (attempt=${ev.attempt}, workerId=${JSON.stringify(ev.workerId)}, leaseId=${JSON.stringify(ev.leaseId)}, fenceToken=${ev.fenceToken}) does not match any declared identity attempt`);
      }
    }
    if (eventIds.has(ev.eventId)) errors.push(`${rel}: duplicate eventId ${JSON.stringify(ev.eventId)}`);
    eventIds.add(ev.eventId);
    if (typeof ev.seq === "number") {
      if (prevSeq !== null && !(ev.seq > prevSeq)) errors.push(`${rel}: event[${idx}] seq must strictly increase`);
      prevSeq = ev.seq;
    }
    if (typeof ev.occurredAt === "string") {
      const t = Date.parse(ev.occurredAt);
      if (!Number.isNaN(t)) {
        if (prevAt !== null && t < prevAt) errors.push(`${rel}: event[${idx}] occurredAt must not move backwards`);
        prevAt = t;
      }
    }
    try {
      const computed = computeEventDigest(ev);
      if (ev.eventDigest !== computed) {
        errors.push(`${rel}: event[${idx}] eventDigest mismatch (recomputed ${computed}, found ${JSON.stringify(ev.eventDigest)})`);
      }
    } catch (err) {
      errors.push(`${rel}: event[${idx}] is not canonicalizable (${err.message})`);
    }
  });

  // Cost / usage bounds.
  const cost = fixture.cost;
  if (isPlainObject(cost)) {
    if (typeof cost.observedTotalCents === "number" && typeof cost.maxTotalCents === "number"
      && cost.observedTotalCents > cost.maxTotalCents) {
      errors.push(`${rel}: cost.observedTotalCents exceeds maxTotalCents`);
    }
    if (typeof cost.observedTokens === "number" && typeof cost.tokenBudget === "number"
      && cost.observedTokens > cost.tokenBudget) {
      errors.push(`${rel}: cost.observedTokens exceeds tokenBudget`);
    }
  }

  // Timing bounds.
  const timing = fixture.timing;
  if (isPlainObject(timing)) {
    const q = Date.parse(timing.queuedAt);
    const s = Date.parse(timing.startedAt);
    const f = Date.parse(timing.finishedAt);
    if (!Number.isNaN(q) && !Number.isNaN(s) && q > s) errors.push(`${rel}: timing.queuedAt is after startedAt`);
    if (!Number.isNaN(s) && !Number.isNaN(f) && s > f) errors.push(`${rel}: timing.startedAt is after finishedAt`);
    if (typeof timing.observedWallClockMs === "number" && typeof timing.maxWallClockMs === "number"
      && timing.observedWallClockMs > timing.maxWallClockMs) {
      errors.push(`${rel}: timing.observedWallClockMs exceeds maxWallClockMs`);
    }
  }

  // Canary non-leakage: each registered secret value appears exactly once in the
  // whole fixture — in its own `canaries[].token` declaration and nowhere else.
  if (Array.isArray(fixture.canaries)) {
    const whole = JSON.stringify(fixture);
    for (const canary of fixture.canaries) {
      if (!isPlainObject(canary) || typeof canary.token !== "string") continue;
      const occurrences = whole.split(canary.token).length - 1;
      if (occurrences !== 1) {
        errors.push(`${rel}: canary token for ${JSON.stringify(canary.id ?? canary.location)} appears ${occurrences} time(s) (must appear only once, in its own declaration)`);
      }
    }
  }
}

/** Orchestrate the FND-004 golden-journey + failure fixture corpus. The
 * optional `parity` (FND-007 legacy-parity authority) binds each fixture's
 * source/principal fields to the frozen execution-source contract. */
async function validateGoldenJourneys(root, errors, parity = null) {
  const schema = await loadAndValidateSchema(root, errors);

  // FND-001 lifecycle state union, for the terminalState cross-check.
  let lifecycleStates = null;
  try {
    const lc = parseJsonStrict(await readFile(path.join(root, LIFECYCLES_JSON), "utf8"));
    if (lc && lc.lifecycles && typeof lc.lifecycles === "object") {
      lifecycleStates = new Set();
      for (const key of Object.keys(lc.lifecycles)) {
        const st = lc.lifecycles[key] && lc.lifecycles[key].states;
        if (Array.isArray(st)) for (const s of st) lifecycleStates.add(s);
      }
    }
  } catch {
    lifecycleStates = null;
  }

  for (const name of GJ_FIXTURES) {
    const rel = `${GJ_DIR}/${name}`;
    const raw = await readOrError(root, rel, errors);
    if (raw == null) continue;
    let fixture;
    try {
      fixture = parseJsonStrict(raw);
    } catch (err) {
      errors.push(`${rel}: ${err.message}`);
      continue;
    }
    if (schema) validateInstance(fixture, schema, schema, rel, errors);
    validateFixtureSemantics(rel, name, fixture, lifecycleStates, errors);
    validateFixtureSourceParity(rel, fixture, parity, errors);
  }
}

// --- FND-005: rollout policy, hosted safety, custodians, evidence integrity ---
//
// This layer adds, on top of FND-001..004:
//   (d) a source-boundary rule over the real app/route registry (server/src/
//       app.ts): no import of a reserved distributed public-ingress or
//       cloud-plugin-runner module and no registration of the two reserved path
//       prefixes;
//   (e) the delivery-policy presence contract + its Decision #121 back-reference;
//   (f) the artifact-policy + evidence-template shape contract (exact-revision +
//       named-owner fields, REQUIRED/HARD/INITIAL/OBSERVED requirement classes,
//       D4/D6 schedule-hash + expected/observed/missing sample fields, ticket-
//       result blob pins, append-only review history, immutable QA/handoff
//       banner + Supersedes, and a bare 40-hex Start SHA example so the gate
//       parser reads it); and
//   (g) an exported evidence-immutability diff (`checkEvidenceImmutability`):
//       given a base revision, reject modification/deletion/rename of an
//       existing QA/handoff record and permit a new higher attempt.

const APP_TS = "server/src/app.ts";

// Reserved distributed modules that the real app/route registry must never
// import (they do not exist; this guards against a future accidental wiring).
const RESERVED_IMPORT_PATTERNS = [
  /distributed[-/]?execution[-/]public[-/]?(service[-/]?)?ingress/i,
  /distributed[-/]public[-/]service[-/]ingress/i,
  /distributed[-/]?execution[-/]cloud[-/]?plugin[-/]?runner/i,
  /cloud[-/]plugin[-/]runner/i,
  /distributed[-/]cloud[-/]plugin/i,
];

const DELIVERY_POLICY_MD = "docs/architecture/distributed-execution-delivery-policy.md";
const DELIVERY_POLICY_FRAGMENTS = [
  "# Distributed Execution Delivery Policy",
  "Protocol Custodian",
  "Migration Custodian",
  "Integration Gate Owner",
  "Security Gate Owner",
  "AOA_DISTRIBUTED_EXECUTION_ENABLED",
  "one ticket",
  "5–10", // "5–10" (en-dash)
];

const ARTIFACT_POLICY_MD = "docs/replatform/artifact-policy.md";
const ARTIFACT_POLICY_FRAGMENTS = [
  "# Re-platform Artifact Policy",
  "exact revision",
  "REQUIRED/HARD/INITIAL/OBSERVED",
  "append-only review ledger",
  "immutable from first commit",
  "Supersedes",
  "ticket-result blob SHAs",
  "blocked_external",
];

const TICKET_TEMPLATE_MD = "docs/replatform/templates/ticket-result-template.md";
const TICKET_TEMPLATE_FRAGMENTS = [
  "**Status:**",
  "**Implementer:**",
  "**Start SHA:**",
  "controlled append-only review ledger",
  "## Review attempt history",
  "pending",
];
// The Start SHA EXAMPLE must be a BARE 40-lowercase-hex placeholder (not
// backtick-wrapped) so the integration-gate parser
// (^\*\*Start SHA:\*\*\s*([0-9a-f]{40})\s*$) reads it. E0-F001.
const TICKET_START_SHA_RE = /^\*\*Start SHA:\*\* [0-9a-f]{40}\s*$/m;

const QA_TEMPLATE_MD = "docs/replatform/templates/qa-result-template.md";
const QA_TEMPLATE_FRAGMENTS = [
  "**Revision:**",
  "immutable from its first commit",
  "**Supersedes:**",
  "REQUIRED",
  "HARD",
  "INITIAL",
  "OBSERVED",
  "Schedule manifest SHA-256",
  "Expected samples",
  "Observed samples",
  "Missing samples",
  "blocked_external",
];

const HANDOFF_TEMPLATE_MD = "docs/replatform/templates/handoff-template.md";
const HANDOFF_TEMPLATE_FRAGMENTS = [
  "**Reviewed revision:**",
  "**Gate owner role:** `Integration Gate Owner`",
  "**Gate owner identity:**",
  "immutable from its first commit",
  "**Supersedes:**",
  "Ticket-result Git blob SHA",
  "REQUIRED",
  "HARD",
  "INITIAL",
  "OBSERVED",
  "blocked_external",
];

/**
 * (d) Source-boundary over the real app/route registry. Reject any import of a
 * reserved distributed public-ingress / cloud-plugin-runner module and any
 * registration of the two reserved distributed path prefixes.
 */
async function validateAppSourceBoundary(root, errors) {
  const content = await readOrError(root, APP_TS, errors);
  if (content == null) return;
  // Import specifiers from `from "..."`, `import("...")`, `require("...")`.
  const specRe = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
  let m;
  while ((m = specRe.exec(content)) !== null) {
    const spec = m[1];
    for (const pat of RESERVED_IMPORT_PATTERNS) {
      if (pat.test(spec)) {
        errors.push(`${APP_TS}: forbidden import of a reserved distributed module ${JSON.stringify(spec)}`);
        break;
      }
    }
  }
  // Reserved path prefixes as quoted registration literals.
  const pathRe = /["'`](\/?(?:api\/)?distributed-execution\/(?:public-services|cloud-plugins))["'`]/g;
  while ((m = pathRe.exec(content)) !== null) {
    errors.push(`${APP_TS}: forbidden registration of a reserved distributed path ${JSON.stringify(m[1])}`);
  }
}

// --- FND-006: hosted plugin process-composition boundary ---------------------
//
// (h) A source-boundary rule over the real cloud-plugin gate and the app
//     composition: on `cloud_auth` (Decision #103 amendment) every plugin sink
//     fails closed, the worker-child marker never grants parent authority, and
//     the effectful worker/lifecycle/loader construction in `app.ts` is guarded.
//     Restoring a cloud sink allowlist, a parent-marker bypass in the gate, or
//     an unguarded construction is a structured failure here — not a runtime
//     test — because the real app is not importable under vitest (finding
//     E0-F005), so this static gate is the portable enforcement.

const CLOUD_PLUGIN_EXECUTION_TS = "server/src/services/cloud-plugin-execution.ts";
const CLOUD_PLUGIN_GATE_FN = "isCloudPluginExecutionBlocked";
// The effectful plugin worker/lifecycle/loader constructors that must be
// composed ONLY off cloud (guarded in app.ts).
const PLUGIN_EFFECTFUL_CONSTRUCTORS = [
  "createPluginWorkerManager(",
  "pluginLifecycleManager(",
  "pluginLoader(",
];

/** Extract the brace-matched body of `function <name>(...) { ... }`. */
function extractFunctionBody(src, name) {
  const sigRe = new RegExp(`function\\s+${name}\\s*\\(`);
  const m = sigRe.exec(src);
  if (!m) return null;
  const open = src.indexOf("{", m.index);
  if (open === -1) return null;
  let depth = 0;
  for (let j = open; j < src.length; j += 1) {
    const ch = src[j];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, j);
    }
  }
  return null;
}

/** Strip `/* *​/` block and `//` line comments (leaves `://` in strings alone). */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * (h) FND-006 hosted plugin process-composition boundary.
 */
async function validateCloudPluginProcessBoundary(root, errors) {
  // (h1) The cloud gate must fail closed for every sink, with no allowlist and
  // no worker-child-marker bypass.
  const gateSrc = await readOrError(root, CLOUD_PLUGIN_EXECUTION_TS, errors);
  if (gateSrc != null) {
    if (gateSrc.includes("CLOUD_SAFE_CONTROL_PLANE_SINKS")) {
      errors.push(
        `${CLOUD_PLUGIN_EXECUTION_TS}: forbidden cloud worker-sink allowlist "CLOUD_SAFE_CONTROL_PLANE_SINKS" — all six plugin sinks must fail closed on cloud_auth (Decision #103)`,
      );
    }
    const body = extractFunctionBody(gateSrc, CLOUD_PLUGIN_GATE_FN);
    if (body == null) {
      errors.push(`${CLOUD_PLUGIN_EXECUTION_TS}: cannot locate the ${CLOUD_PLUGIN_GATE_FN} function body`);
    } else {
      const b = stripComments(body);
      if (!/tenantIsolationEnforced\s*\(\s*\)/.test(b)) {
        errors.push(
          `${CLOUD_PLUGIN_EXECUTION_TS}: ${CLOUD_PLUGIN_GATE_FN} must gate on tenantIsolationEnforced()`,
        );
      }
      // No worker-child-marker bypass: the gate must never consult the marker.
      if (
        /process\.env/.test(b) ||
        /PLUGIN_WORKER_PROCESS_ENV_VAR/.test(b) ||
        /AOA_PLUGIN_WORKER_PROCESS/.test(b) ||
        /isRunningInsidePluginWorkerChild/.test(b)
      ) {
        errors.push(
          `${CLOUD_PLUGIN_EXECUTION_TS}: ${CLOUD_PLUGIN_GATE_FN} must not consult the worker-child marker (AOA_PLUGIN_WORKER_PROCESS) — it can never grant the hosted parent authority`,
        );
      }
      // No sink allowlist via set membership.
      if (/\.has\s*\(/.test(b)) {
        errors.push(
          `${CLOUD_PLUGIN_EXECUTION_TS}: ${CLOUD_PLUGIN_GATE_FN} must not allowlist any sink via set membership on cloud_auth`,
        );
      }
      // Fail closed uniformly: no sink-specific return false/true escape.
      if (/return\s+false/.test(b) || /return\s+true/.test(b)) {
        errors.push(
          `${CLOUD_PLUGIN_EXECUTION_TS}: ${CLOUD_PLUGIN_GATE_FN} must fail closed uniformly (no sink-specific "return false"/"return true"); use "return tenantIsolationEnforced()"`,
        );
      }
    }
  }

  // (h2) app.ts must guard the effectful worker/lifecycle/loader construction
  // behind the cloud process-disable check.
  const appSrc = await readOrError(root, APP_TS, errors);
  if (appSrc != null) {
    const guardDef =
      /const\s+hostedPluginProcessDisabled\s*=\s*tenantIsolationEnforced\s*\(\s*\)/;
    if (!guardDef.test(appSrc)) {
      errors.push(
        `${APP_TS}: missing the cloud plugin process-disable guard (const hostedPluginProcessDisabled = tenantIsolationEnforced())`,
      );
    }
    const guardOpen = /if\s*\(\s*!\s*hostedPluginProcessDisabled\b/;
    const guardMatch = guardOpen.exec(appSrc);
    if (!guardMatch) {
      errors.push(
        `${APP_TS}: plugin worker/lifecycle/loader composition is not guarded by "if (!hostedPluginProcessDisabled)"`,
      );
    }
    const guardIdx = guardMatch ? guardMatch.index : Infinity;
    for (const ctor of PLUGIN_EFFECTFUL_CONSTRUCTORS) {
      const idx = appSrc.indexOf(ctor);
      if (idx !== -1 && idx < guardIdx) {
        errors.push(
          `${APP_TS}: unguarded plugin ${ctor.slice(0, -1)} construction — must be inside the !hostedPluginProcessDisabled guard (FND-006)`,
        );
      }
    }
  }
}

/** (e)+(f) Delivery policy + artifact-policy/evidence-template shape contract. */
async function validateDeliveryAndEvidence(root, errors) {
  await requireFile(root, DELIVERY_POLICY_MD, DELIVERY_POLICY_FRAGMENTS, errors);
  await requireFile(root, ARTIFACT_POLICY_MD, ARTIFACT_POLICY_FRAGMENTS, errors);

  const ticket = await requireFile(root, TICKET_TEMPLATE_MD, TICKET_TEMPLATE_FRAGMENTS, errors);
  if (ticket != null && !TICKET_START_SHA_RE.test(ticket)) {
    errors.push(
      `${TICKET_TEMPLATE_MD}: Start SHA example must be a bare 40-lowercase-hex placeholder (not backtick-wrapped) so the integration-gate parser reads it`,
    );
  }
  await requireFile(root, QA_TEMPLATE_MD, QA_TEMPLATE_FRAGMENTS, errors);
  await requireFile(root, HANDOFF_TEMPLATE_MD, HANDOFF_TEMPLATE_FRAGMENTS, errors);
}

/** Collect immutable evidence records (qa/ + handoffs/) under an epic tree. */
async function collectEvidenceRecords(root) {
  const map = new Map();
  const epicsAbs = path.join(root, "docs", "replatform", "epics");
  let epics;
  try {
    epics = await readdir(epicsAbs, { withFileTypes: true });
  } catch {
    return map;
  }
  for (const epic of epics) {
    if (!epic.isDirectory()) continue;
    for (const sub of ["qa", "handoffs"]) {
      const dirAbs = path.join(epicsAbs, epic.name, sub);
      let entries;
      try {
        entries = await readdir(dirAbs, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "README.md") continue;
        const rel = `docs/replatform/epics/${epic.name}/${sub}/${entry.name}`;
        map.set(rel, await readFile(path.join(dirAbs, entry.name), "utf8"));
      }
    }
  }
  return map;
}

/**
 * (g) Evidence immutability. Given a base revision (baseRoot) and a candidate
 * revision (candidateRoot), reject modification, deletion, or rename of any
 * existing QA/handoff record, and permit a new higher attempt (a record present
 * only in the candidate). Exercised by the mutation test with temp fixture
 * trees; QA/handoff records are write-once per the artifact policy.
 */
export async function checkEvidenceImmutability(baseRoot, candidateRoot) {
  const errors = [];
  const base = await collectEvidenceRecords(baseRoot);
  const cand = await collectEvidenceRecords(candidateRoot);
  for (const [rel, content] of base) {
    if (!cand.has(rel)) {
      errors.push(`evidence immutability: base record ${rel} was deleted or renamed after commit`);
    } else if (cand.get(rel) !== content) {
      errors.push(`evidence immutability: base record ${rel} was modified after commit`);
    }
  }
  return { errors };
}

// --- FND-007: execution-source freeze + legacy parity + current-main crosswalk ---
//
// This layer freezes, as machine-checkable authorities:
//   (i)  the six current-main execution-source kinds and their legacy parity
//        matrix in `distributed-execution-legacy-parity.json`: per kind, the
//        required/forbidden source fields, opaque requester/executor principal
//        kinds, the owning crosswalk `CM-*` rows, and a behavior (or a justified
//        `not_applicable`) for every parity dimension. Only `task_run` requires
//        `runId`/`issueId`; the other five forbid them. The exact six-kind set is
//        count-pinned and unknown kinds/dimensions are rejected (E0-F003).
//   (ii) the current-main crosswalk `current-main-crosswalk.md`: the CM
//        (execution/lifecycle) and CP (cloud-plugin) tables are parsed as
//        structured tables with contiguous unique row IDs (CM-001..CM-015,
//        CP-001..CP-005 — exact set, count-pinned, unknown/extra rejected),
//        explicit enumerated owner ticket IDs (ranges/prose invalid) that all
//        exist in program-design.md, non-empty current-authority + disposition
//        cells, per-CM-row shadow/drain/rollback + hard-negative evidence, and
//        the CM-015 migration-0188 snapshot/marker seam with a per-clause-negated
//        no-auto-bypass invariant (E0-F003 per-clause negation scoping).
//  (iii) the fixture source/principal binding: each golden-journey fixture's
//        source kind, requester/executor principal kinds, forbidden/required
//        source fields, and Organization are validated against the authority.

const LEGACY_PARITY_JSON = "docs/architecture/distributed-execution-legacy-parity.json";
const CROSSWALK_MD = "docs/replatform/current-main-crosswalk.md";

// The exact six execution-source kinds (count-pinned, reject unknown — E0-F003).
const SOURCE_KINDS = [
  "task_run",
  "commander_turn",
  "crew_run",
  "one_shot",
  "browser_request",
  "service_reconcile",
];

// Every parity dimension each source kind must declare (behavior or justified
// not_applicable). Exact set; an unknown dimension is rejected.
const PARITY_DIMENSIONS = [
  "checkout_assignment",
  "capacity_claim_release_wakeup",
  "product_runtime_approval",
  "budget",
  "audit",
  "cost",
  "output_run_summary",
  "completion_cancel_retry",
];

// Opaque principal kinds (must stay aligned with the fixture schema's
// Requester.type / Executor.type enums).
const REQUESTER_PRINCIPAL_KINDS = new Set([
  "founder", "team_lead", "team_member", "agent", "commander", "mcp_key", "system",
]);
const EXECUTOR_PRINCIPAL_KINDS = new Set([
  "worker", "sandbox", "browser_worker", "service_instance",
]);

// Contiguous stable crosswalk row-ID sets (exact set + count — E0-F003 item 2).
function contiguousIds(prefix, count) {
  return Array.from({ length: count }, (_, i) => `${prefix}-${String(i + 1).padStart(3, "0")}`);
}
const EXPECTED_CM_IDS = contiguousIds("CM", 15);
const EXPECTED_CP_IDS = contiguousIds("CP", 5);

const CROSSWALK_CM_HEADING = "## Execution and lifecycle sinks";
const CROSSWALK_CP_HEADING = "## Cloud plugin and host-extension sinks";
const CROSSWALK_CM_HEADER = [
  "Row ID", "Current sink", "Observed current authority and implementation",
  "Target disposition", "Owning ticket IDs", "Required cutover and evidence",
];
const CROSSWALK_CP_HEADER = [
  "Row ID", "Current sink family", "Observed current composition",
  "Required disposition", "Owner and evidence",
];

// Migration (CM) rows carry the full shadow/drain/rollback contract; the plugin
// (CP) rows are disable-not-migrate rows (block in cloud, preserve self-hosted)
// per the crosswalk's own framing, so they are NOT required to carry cutover/
// drain/rollback tokens — only enumerated owners + a hard-negative.
const CM_EVIDENCE_TOKENS = ["shadow", "drain", "rollback"];
const CROSSWALK_HARD_NEGATIVE_RE =
  /\b(?:no|never|not|cannot|deny|denies|denial|denied|reject|rejects|fail|fails|zero|without|block|blocks|blocked)\b/i;

// CM-015 is the post-PR #320 migration-0188 snapshot/`cloud_auth` flip-marker
// seam; it must carry the marker write path + snapshot evidence + a no-auto-
// bypass invariant.
const CM_MIGRATION_MARKER_ROW = "CM-015";
const CM_MIGRATION_MARKER_TOKENS = ["record_0188_marker", "snapshot", "marker"];

/** A ticket-ID token appears once; also used to reject range syntax. */
function cellTicketIds(cell) {
  return cell.match(TICKET_ID_RE) || [];
}

/**
 * True when a cell is a pure enumerated ticket-ID list (comma/"and" separated).
 * A range (`JOB-010–JOB-014`, `JOB-010..JOB-014`, `… through …`) or free prose
 * leaves a non-empty residue and is rejected — the crosswalk requires explicit
 * enumerated IDs, never ranges or prose.
 */
function isEnumeratedTicketList(cell) {
  const residue = cell
    .replace(TICKET_ID_RE, " ")
    .replace(/,/g, " ")
    .replace(/\band\b/gi, " ")
    .trim();
  return residue === "";
}

/** Split a row's text into clauses for per-clause negation scoping (E0-F003). */
function crosswalkClauses(text) {
  return text.split(/[;.,|]/).map((c) => c.trim()).filter(Boolean);
}

/** Extract a section's first table restricted to a Row-ID-led table (CM/CP). */
function extractCrosswalkTable(md, heading) {
  const body = sectionBody(md, heading);
  if (body == null) return null;
  return extractTable(body);
}

/**
 * Validate one crosswalk table (CM or CP) against its expected contiguous ID set
 * and per-row field requirements. Returns the set of parsed row IDs.
 */
function validateCrosswalkTable(table, kind, expectedIds, header, validTicketIds, errors) {
  const ids = [];
  const idSet = new Set();
  if (
    table.header.length !== header.length ||
    !header.every((h, i) => table.header[i] === h)
  ) {
    errors.push(`${CROSSWALK_MD}: ${kind} table header must be ${JSON.stringify(header)}, found ${JSON.stringify(table.header)}`);
  }
  const isCm = kind === "CM";
  const ownerCol = isCm ? 4 : 4;
  const authorityCol = 2;
  const dispositionCol = 3;
  const evidenceCol = isCm ? 5 : 4;

  for (const cells of table.rows) {
    const id = cells[0];
    if (!/^(?:CM|CP)-\d{3}$/.test(id)) {
      errors.push(`${CROSSWALK_MD}: ${kind} row has an unparseable Row ID ${JSON.stringify(id)}`);
      continue;
    }
    if (idSet.has(id)) errors.push(`${CROSSWALK_MD}: duplicate ${kind} row ${id}`);
    idSet.add(id);
    ids.push(id);
    if (!expectedIds.includes(id)) {
      errors.push(`${CROSSWALK_MD}: unknown/extra ${kind} row ${id} (expected exactly ${expectedIds[0]}..${expectedIds[expectedIds.length - 1]})`);
    }

    // Non-empty current-authority + disposition cells.
    if (!cells[authorityCol] || cells[authorityCol].trim() === "") {
      errors.push(`${CROSSWALK_MD}: ${id} has an empty current-authority cell`);
    }
    if (!cells[dispositionCol] || cells[dispositionCol].trim() === "") {
      errors.push(`${CROSSWALK_MD}: ${id} has an empty disposition cell`);
    }

    // Owner ticket IDs: at least one, all defined in program-design.
    const ownerCell = cells[ownerCol] || "";
    const ownerIds = cellTicketIds(ownerCell);
    if (ownerIds.length === 0) {
      errors.push(`${CROSSWALK_MD}: ${id} has no owner ticket ID`);
    } else if (validTicketIds != null) {
      for (const t of ownerIds) {
        if (!validTicketIds.has(t)) {
          errors.push(`${CROSSWALK_MD}: ${id} references unknown owner ticket "${t}" (not defined in ${PROGRAM_DESIGN_MD})`);
        }
      }
    }
    // CM owner cell is a pure enumerated ID list — ranges/prose invalid.
    if (isCm && ownerCell.trim() !== "" && !isEnumeratedTicketList(ownerCell)) {
      errors.push(`${CROSSWALK_MD}: ${id} owner cell ${JSON.stringify(ownerCell)} is not an enumerated ticket-ID list (ranges/prose are invalid)`);
    }

    const rowText = cells.join(" | ");
    const evidence = cells[evidenceCol] || "";
    if (isCm) {
      // Migration rows carry the full shadow/drain/rollback + hard-negative contract.
      for (const token of CM_EVIDENCE_TOKENS) {
        if (!evidence.toLowerCase().includes(token)) {
          errors.push(`${CROSSWALK_MD}: ${id} evidence is missing the "${token}" field`);
        }
      }
      if (!CROSSWALK_HARD_NEGATIVE_RE.test(evidence)) {
        errors.push(`${CROSSWALK_MD}: ${id} evidence carries no hard-negative`);
      }
      if (id === CM_MIGRATION_MARKER_ROW) {
        for (const token of CM_MIGRATION_MARKER_TOKENS) {
          if (!rowText.toLowerCase().includes(token.toLowerCase())) {
            errors.push(`${CROSSWALK_MD}: ${id} is missing the migration-0188 snapshot/marker evidence "${token}"`);
          }
        }
        // No-auto-bypass invariant: every clause mentioning auto-bypass must be
        // negated in that same clause (per-clause negation scoping — E0-F003).
        const bypassClauses = crosswalkClauses(rowText).filter((c) => /auto-?bypass/i.test(c));
        if (bypassClauses.length === 0) {
          errors.push(`${CROSSWALK_MD}: ${id} must state the migration-0188 gate never auto-bypasses`);
        }
        for (const clause of bypassClauses) {
          if (!CROSSWALK_HARD_NEGATIVE_RE.test(clause)) {
            errors.push(`${CROSSWALK_MD}: ${id} auto-bypass clause asserted without negation: ${JSON.stringify(clause)}`);
          }
        }
      }
    } else {
      // CP disable rows: a hard-negative in the disposition or owner/evidence cell.
      const cpText = `${cells[dispositionCol] || ""} ${evidence}`;
      if (!CROSSWALK_HARD_NEGATIVE_RE.test(cpText)) {
        errors.push(`${CROSSWALK_MD}: ${id} disposition/evidence carries no hard-negative`);
      }
    }
  }

  // Exact set + count parity (missing / extra / gap — E0-F003 item 2).
  for (const want of expectedIds) {
    if (!idSet.has(want)) errors.push(`${CROSSWALK_MD}: ${kind} table is missing required row ${want}`);
  }
  if (ids.length !== expectedIds.length) {
    errors.push(`${CROSSWALK_MD}: ${kind} table must have exactly ${expectedIds.length} rows, found ${ids.length}`);
  }
  return idSet;
}

/** Parse + validate the current-main crosswalk. Returns the CM row-ID set. */
async function validateCrosswalk(root, errors, validTicketIds) {
  const md = await readOrError(root, CROSSWALK_MD, errors);
  if (md == null) return null;
  let cmIds = new Set();
  const cmTable = extractCrosswalkTable(md, CROSSWALK_CM_HEADING);
  if (!cmTable) {
    errors.push(`${CROSSWALK_MD}: missing the execution/lifecycle (CM) sink table under ${JSON.stringify(CROSSWALK_CM_HEADING)}`);
  } else {
    cmIds = validateCrosswalkTable(cmTable, "CM", EXPECTED_CM_IDS, CROSSWALK_CM_HEADER, validTicketIds, errors);
  }
  const cpTable = extractCrosswalkTable(md, CROSSWALK_CP_HEADING);
  if (!cpTable) {
    errors.push(`${CROSSWALK_MD}: missing the cloud-plugin (CP) sink table under ${JSON.stringify(CROSSWALK_CP_HEADING)}`);
  } else {
    validateCrosswalkTable(cpTable, "CP", EXPECTED_CP_IDS, CROSSWALK_CP_HEADER, validTicketIds, errors);
  }
  return cmIds;
}

/**
 * Parse + validate the legacy-parity authority. Returns { byKind, sentinels }
 * (or null) for the fixture source/principal binding.
 */
async function validateLegacyParity(root, errors, crosswalkCmIds) {
  const raw = await readOrError(root, LEGACY_PARITY_JSON, errors);
  if (raw == null) return null;
  let doc;
  try {
    doc = parseJsonStrict(raw);
  } catch (err) {
    errors.push(`${LEGACY_PARITY_JSON}: invalid JSON (${err.message})`);
    return null;
  }
  if (typeof doc.version !== "number") {
    errors.push(`${LEGACY_PARITY_JSON}: missing numeric "version"`);
  }
  if (!Array.isArray(doc.forbiddenOrganizationSentinels) || doc.forbiddenOrganizationSentinels.length === 0) {
    errors.push(`${LEGACY_PARITY_JSON}: missing non-empty "forbiddenOrganizationSentinels" array`);
  }
  if (!Array.isArray(doc.sources)) {
    errors.push(`${LEGACY_PARITY_JSON}: missing array "sources"`);
    return null;
  }

  const byKind = new Map();
  const seenKinds = new Set();
  for (let idx = 0; idx < doc.sources.length; idx += 1) {
    const s = doc.sources[idx];
    if (s == null || typeof s !== "object" || Array.isArray(s)) {
      errors.push(`${LEGACY_PARITY_JSON}: source at index ${idx} is not an object`);
      continue;
    }
    const label = typeof s.kind === "string" && s.kind ? s.kind : `index ${idx}`;

    if (typeof s.kind !== "string" || !SOURCE_KINDS.includes(s.kind)) {
      errors.push(`${LEGACY_PARITY_JSON}: source ${label} has an unknown or missing source kind`);
    } else {
      if (seenKinds.has(s.kind)) errors.push(`${LEGACY_PARITY_JSON}: duplicate source kind "${s.kind}"`);
      seenKinds.add(s.kind);
      byKind.set(s.kind, s);
    }

    for (const f of ["requiredFields", "forbiddenFields", "requesterPrincipalKinds", "executorPrincipalKinds", "crosswalkRows"]) {
      if (!Array.isArray(s[f])) {
        errors.push(`${LEGACY_PARITY_JSON}: source ${label} field "${f}" must be an array`);
      }
    }

    if (Array.isArray(s.requesterPrincipalKinds)) {
      if (s.requesterPrincipalKinds.length === 0) {
        errors.push(`${LEGACY_PARITY_JSON}: source ${label} "requesterPrincipalKinds" must be non-empty`);
      }
      for (const p of s.requesterPrincipalKinds) {
        if (!REQUESTER_PRINCIPAL_KINDS.has(p)) {
          errors.push(`${LEGACY_PARITY_JSON}: source ${label} requester principal kind ${JSON.stringify(p)} is unknown`);
        }
      }
    }
    if (Array.isArray(s.executorPrincipalKinds)) {
      if (s.executorPrincipalKinds.length === 0) {
        errors.push(`${LEGACY_PARITY_JSON}: source ${label} "executorPrincipalKinds" must be non-empty`);
      }
      for (const p of s.executorPrincipalKinds) {
        if (!EXECUTOR_PRINCIPAL_KINDS.has(p)) {
          errors.push(`${LEGACY_PARITY_JSON}: source ${label} executor principal kind ${JSON.stringify(p)} is unknown`);
        }
      }
    }

    // Only task_run carries run/issue identity; the other five forbid it.
    const req = new Set(Array.isArray(s.requiredFields) ? s.requiredFields : []);
    const forb = new Set(Array.isArray(s.forbiddenFields) ? s.forbiddenFields : []);
    if (s.kind === "task_run") {
      for (const f of ["runId", "issueId"]) {
        if (!req.has(f)) errors.push(`${LEGACY_PARITY_JSON}: source task_run must require "${f}"`);
        if (forb.has(f)) errors.push(`${LEGACY_PARITY_JSON}: source task_run must not forbid "${f}"`);
      }
    } else if (typeof s.kind === "string" && SOURCE_KINDS.includes(s.kind)) {
      for (const f of ["runId", "issueId"]) {
        if (!forb.has(f)) errors.push(`${LEGACY_PARITY_JSON}: source ${label} must forbid "${f}" (only task_run carries run/issue identity)`);
        if (req.has(f)) errors.push(`${LEGACY_PARITY_JSON}: source ${label} must not require "${f}" (only task_run carries run/issue identity)`);
      }
    }

    // Crosswalk-row references must exist in the crosswalk CM set (JSON<->MD drift).
    if (Array.isArray(s.crosswalkRows) && crosswalkCmIds) {
      for (const cm of s.crosswalkRows) {
        if (typeof cm !== "string" || !crosswalkCmIds.has(cm)) {
          errors.push(`${LEGACY_PARITY_JSON}: source ${label} references crosswalk row ${JSON.stringify(cm)} not present in ${CROSSWALK_MD}`);
        }
      }
    }

    // Every parity dimension present as a behavior string or justified not_applicable.
    const parity = s.parity;
    if (parity == null || typeof parity !== "object" || Array.isArray(parity)) {
      errors.push(`${LEGACY_PARITY_JSON}: source ${label} is missing a "parity" object`);
    } else {
      for (const dim of PARITY_DIMENSIONS) {
        if (!(dim in parity)) {
          errors.push(`${LEGACY_PARITY_JSON}: source ${label} is missing parity dimension "${dim}"`);
          continue;
        }
        const v = parity[dim];
        if (typeof v === "string") {
          if (v.trim() === "") {
            errors.push(`${LEGACY_PARITY_JSON}: source ${label} parity dimension "${dim}" must be a non-empty behavior string`);
          } else if (v.trim() === "not_applicable") {
            errors.push(`${LEGACY_PARITY_JSON}: source ${label} parity dimension "${dim}" is a bare "not_applicable" without justification`);
          }
        } else if (v != null && typeof v === "object" && !Array.isArray(v)) {
          if (v.status !== "not_applicable") {
            errors.push(`${LEGACY_PARITY_JSON}: source ${label} parity dimension "${dim}" object must set status "not_applicable"`);
          } else if (typeof v.justification !== "string" || v.justification.trim() === "") {
            errors.push(`${LEGACY_PARITY_JSON}: source ${label} parity dimension "${dim}" is not_applicable without a non-empty justification`);
          }
        } else {
          errors.push(`${LEGACY_PARITY_JSON}: source ${label} parity dimension "${dim}" must be a behavior string or a justified not_applicable object`);
        }
      }
      for (const k of Object.keys(parity)) {
        if (!PARITY_DIMENSIONS.includes(k)) {
          errors.push(`${LEGACY_PARITY_JSON}: source ${label} has unknown parity dimension "${k}"`);
        }
      }
    }
  }

  // Exact six-kind set (missing + count — reject unknown/extra, E0-F003).
  for (const k of SOURCE_KINDS) {
    if (!seenKinds.has(k)) errors.push(`${LEGACY_PARITY_JSON}: missing required source kind "${k}"`);
  }
  if (doc.sources.length !== SOURCE_KINDS.length) {
    errors.push(`${LEGACY_PARITY_JSON}: expected exactly ${SOURCE_KINDS.length} source kinds, found ${doc.sources.length}`);
  }

  return {
    byKind,
    sentinels: new Set(Array.isArray(doc.forbiddenOrganizationSentinels) ? doc.forbiddenOrganizationSentinels : []),
  };
}

/**
 * Bind one fixture's source/principal fields to the legacy-parity authority:
 * requester/executor principal kinds, forbidden/required source fields, and the
 * sentinel-Organization block. The schema already enforces the source-kind
 * discriminant; this is the authority-sourced second enforcement.
 */
function validateFixtureSourceParity(rel, fixture, parity, errors) {
  if (!parity || !isPlainObject(fixture)) return;

  // Sentinel-Organization admission (fail-open DEFAULT_ORGANIZATION_ID, TEN-006).
  const org = fixture.organization;
  const orgId = isPlainObject(org) ? org.id : undefined;
  if (typeof orgId === "string" && parity.sentinels.has(orgId)) {
    errors.push(`${rel}: sentinel Organization admission — organization.id ${JSON.stringify(orgId)} is a forbidden sentinel`);
  }

  const src = fixture.source;
  const kind = isPlainObject(src) ? src.kind : undefined;
  if (typeof kind !== "string") return;
  const spec = parity.byKind.get(kind);
  if (!spec) return; // unknown kind already flagged by the schema enum

  const rk = isPlainObject(fixture.requester) ? fixture.requester.type : undefined;
  const ek = isPlainObject(fixture.executor) ? fixture.executor.type : undefined;
  if (typeof rk === "string" && Array.isArray(spec.requesterPrincipalKinds) && !spec.requesterPrincipalKinds.includes(rk)) {
    errors.push(`${rel}: requester principal "${rk}" is not permitted for source kind "${kind}"`);
  }
  if (typeof ek === "string" && Array.isArray(spec.executorPrincipalKinds) && !spec.executorPrincipalKinds.includes(ek)) {
    errors.push(`${rel}: executor principal "${ek}" is not permitted for source kind "${kind}"`);
  }
  for (const f of Array.isArray(spec.forbiddenFields) ? spec.forbiddenFields : []) {
    if (f in src) errors.push(`${rel}: source kind "${kind}" must not carry forbidden field "${f}" (fabricated provenance)`);
  }
  for (const f of Array.isArray(spec.requiredFields) ? spec.requiredFields : []) {
    if (!(f in src)) errors.push(`${rel}: source kind "${kind}" must carry required field "${f}"`);
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
    if (!decisions.includes("distributed-execution-delivery-policy.md")) {
      errors.push(`${DECISIONS_MD}: missing reference to "distributed-execution-delivery-policy.md"`);
    }
    if (!decisions.includes("distributed-execution-legacy-parity.json")) {
      errors.push(`${DECISIONS_MD}: missing reference to "distributed-execution-legacy-parity.json"`);
    }
    if (!decisions.includes("current-main-crosswalk.md")) {
      errors.push(`${DECISIONS_MD}: missing reference to "current-main-crosswalk.md"`);
    }
  }

  // FND-002 authority contract (independent of the lifecycle JSON/Markdown).
  await validateAuthority(root, errors);

  // FND-003 threat model + control ownership contract.
  await validateThreatModel(root, errors);

  // FND-007 current-main crosswalk + legacy-parity authority (before the
  // fixtures, so their source/principal fields bind to the frozen contract).
  const validTicketIds = await parseProgramTicketIds(root, errors);
  const crosswalkCmIds = await validateCrosswalk(root, errors, validTicketIds);
  const legacyParity = await validateLegacyParity(root, errors, crosswalkCmIds);

  // FND-004 golden-journey + failure fixture corpus (+ FND-007 source binding).
  await validateGoldenJourneys(root, errors, legacyParity);

  // FND-005 source-boundary + delivery-policy + evidence-integrity contracts.
  await validateAppSourceBoundary(root, errors);
  await validateDeliveryAndEvidence(root, errors);

  // FND-006 hosted plugin process-composition boundary.
  await validateCloudPluginProcessBoundary(root, errors);

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
