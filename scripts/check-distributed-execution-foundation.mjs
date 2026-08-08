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
import { fileURLToPath, pathToFileURL } from "node:url";

const LIFECYCLES_JSON = "docs/architecture/distributed-execution-lifecycles.json";
const LIFECYCLES_MD = "docs/architecture/distributed-execution-lifecycles.md";
const DECISIONS_MD = "docs/architecture/decisions.md";

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
  }

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

// Exported for the node:test harness.
export const __test = {
  fileURLToPath,
  LIFECYCLES_JSON,
  LIFECYCLES_MD,
  DECISIONS_MD,
};
