// scripts/lib/__tests__/w10b-egress-enforcement-probe.test.mjs
//
// W10B's decision logic, proven WITHOUT a key, on every PR, in the required `policy` job.
//
// ★ WHY THIS FILE IS NOT OPTIONAL. The keyed lane runs ONCE, on an operator's
// authorisation, against real E2B. If the first execution of the code that reads that run
// is the run itself, every defect in it is discovered by spending the authorisation — which
// is exactly the shape the first keyed conformance run produced (8 failures out of 18,
// `CLI-realE2B-hardening-result.md`). So every classification, every verdict, the CIDR
// engine behind the ABANDON question, the redactor and the durable-record builder are pure
// functions here, and this file drives them.
//
// It also pins TWO PREMISES that would silently rot:
//   * that the lane's YAML still carries its `always()` record guards, its fallback writer,
//     its template default and its keyless positive control (`evaluateDurableRecord` run
//     against the real workflow bytes);
//   * that the stale-premise correction this unit made to
//     `server/src/services/sandbox-provider-runtime.ts` is still there, so nobody restores
//     "managed E2B egress is not fully lockable" as an unqualified claim without this step
//     going red.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AOA_API_TARGET_ID,
  ALL_TRAFFIC_SENTINEL,
  BARE_BASE_TEMPLATE_ALIAS,
  DEFAULT_AOA_API_URL,
  DENY_SET_V4,
  DENY_SET_V6,
  HTTP_TARGETS,
  METADATA_V4,
  MIN_REDACTABLE_SECRET_LENGTH,
  NON_MATCHING_DENY_SET,
  PROBE_MARKER,
  PROBE_RECORD_SCHEMA,
  PROBE_STATES,
  PROBE_TEMPLATE_ALIAS,
  ProbeCommandError,
  ProbeRecordError,
  RAW_TARGETS,
  REDACTION_MARKER,
  TARGET_ROLES,
  blockShape,
  buildHttpTargetCommand,
  buildProbeRecord,
  classifyHttpRow,
  classifyRawRow,
  classifyResolvers,
  decideOption,
  denyCidrs,
  evaluateControls,
  evaluateDurableRecord,
  formatVerdict,
  ipv4InCidr,
  looksLikeIpv6,
  packDisposition,
  parseIpv4,
  parseIpv4Cidr,
  parseProbeLine,
  parseResolvConf,
  redactSecrets,
  resolveAoaApiTarget,
  resolveTemplate,
  verdictEnforcementLayer,
  verdictHonoured,
  verdictProductRegression,
  verdictReadBack,
  verdictResolverInDenySet,
  verdictWarmReassert,
} from "../w10b-egress-enforcement-probe.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const WORKFLOW_PATH = path.join(ROOT, ".github", "workflows", "keyed-e2b-w10b-egress-enforcement-probe.yml");
const PROVIDER_RUNTIME_PATH = path.join(ROOT, "server", "src", "services", "sandbox-provider-runtime.ts");

// ─────────────────────────────────────────────────────────────────────────────
// Fixture builders — a green baseline every negative case perturbs by ONE thing.
// ─────────────────────────────────────────────────────────────────────────────

const row = (id, exitCode, detail = "") => ({ id, exitCode, detail });
const reached = (id, code = "200") => row(id, 0, code);
const timedOut = (id) => row(id, 28, "curl: (28) Operation timed out");
const refused = (id) => row(id, 7, "curl: (7) Failed to connect");
const dnsFailed = (id) => row(id, 6, "curl: (6) Could not resolve host");

const ALL_HTTP_IDS = HTTP_TARGETS.map((t) => t.id);

function policyArm(overrides = {}) {
  const rows = {
    allowed_public: reached("allowed_public"),
    unresolvable: dnsFailed("unresolvable"),
    metadata_v4: timedOut("metadata_v4"),
    metadata_v4_mapped: timedOut("metadata_v4_mapped"),
    metadata_v4_mapped_hex: timedOut("metadata_v4_mapped_hex"),
    metadata_v6: timedOut("metadata_v6"),
    rfc1918_10: timedOut("rfc1918_10"),
    dns_dependent: reached("dns_dependent"),
    model_api: reached("model_api", "401"),
    ...(overrides.rows ?? {}),
  };
  return {
    label: "P/policy",
    created: true,
    expectedRowIds: ALL_HTTP_IDS,
    rows,
    rawRows: {
      raw_tcp_nonhttp: { id: "raw_tcp_nonhttp", exitCode: 0, detail: "timed-out after 8s", tool: "python3" },
      raw_http_bytes: { id: "raw_http_bytes", exitCode: 0, detail: "timed-out after 8s", tool: "python3" },
      ...(overrides.rawRows ?? {}),
    },
    ...(overrides.extra ?? {}),
  };
}

function antiVacuityArm(overrides = {}) {
  const rows = {
    allowed_public: reached("allowed_public"),
    unresolvable: dnsFailed("unresolvable"),
    metadata_v4: reached("metadata_v4", "401"),
    metadata_v4_mapped: reached("metadata_v4_mapped", "401"),
    metadata_v4_mapped_hex: reached("metadata_v4_mapped_hex", "401"),
    metadata_v6: timedOut("metadata_v6"),
    rfc1918_10: timedOut("rfc1918_10"),
    dns_dependent: reached("dns_dependent"),
    model_api: reached("model_api", "401"),
    ...(overrides.rows ?? {}),
  };
  return {
    label: "N/anti-vacuity",
    created: true,
    expectedRowIds: ALL_HTTP_IDS,
    rows,
    rawRows: {
      raw_tcp_nonhttp: { id: "raw_tcp_nonhttp", exitCode: 0, detail: "connected", tool: "python3" },
      raw_http_bytes: { id: "raw_http_bytes", exitCode: 0, detail: "connected", tool: "python3" },
      ...(overrides.rawRows ?? {}),
    },
    ...(overrides.extra ?? {}),
  };
}

const greenControls = () => evaluateControls({ policyArm: policyArm(), antiVacuityArm: antiVacuityArm() });

// ─────────────────────────────────────────────────────────────────────────────
// 0. Vocabulary and shape
// ─────────────────────────────────────────────────────────────────────────────

test("the three states are exactly yes/no/inconclusive, and every role is declared", () => {
  assert.deepEqual([...PROBE_STATES], ["yes", "no", "inconclusive"]);
  for (const t of HTTP_TARGETS) assert.ok(TARGET_ROLES.includes(t.role), `${t.id} has an undeclared role ${t.role}`);
  // Each mandatory control has exactly one row, so a control cannot be satisfied by a
  // second, weaker copy of itself.
  assert.equal(HTTP_TARGETS.filter((t) => t.role === "positive_control").length, 1);
  assert.equal(HTTP_TARGETS.filter((t) => t.role === "apparatus_control").length, 1);
  assert.ok(HTTP_TARGETS.some((t) => t.role === "question"));
  assert.ok(HTTP_TARGETS.some((t) => t.role === "product_regression"));
});

test("the apparatus control is an RFC-2606 .invalid host and the positive control is not internal", () => {
  const apparatus = HTTP_TARGETS.find((t) => t.role === "apparatus_control");
  assert.match(apparatus.url, /\.invalid\//);
  const positive = HTTP_TARGETS.find((t) => t.role === "positive_control");
  assert.equal(positive.url.includes(METADATA_V4), false);
  for (const entry of DENY_SET_V4) assert.equal(positive.url.includes(entry.cidr.split("/")[0]), false);
});

test("the deny set omits loopback and CGNAT deliberately, and the anti-vacuity set contains no target", () => {
  const cidrs = denyCidrs(DENY_SET_V4);
  assert.equal(cidrs.includes("127.0.0.0/8"), false, "loopback must stay out: it can carry the guest's own resolver stub");
  assert.equal(cidrs.includes("100.64.0.0/10"), false, "CGNAT must stay out: cloud fabrics use it for infrastructure the sandbox needs");
  assert.ok(cidrs.includes("169.254.0.0/16"), "the metadata range is the whole point");
  // ★ THE ANTI-VACUITY SET MUST NOT CONTAIN THE QUESTION TARGET. If it did, both arms would
  // deny it, the differential would compare a thing with itself, and a block in the policy
  // arm would be attributable to nothing.
  for (const entry of NON_MATCHING_DENY_SET) assert.equal(ipv4InCidr(METADATA_V4, entry.cidr), false);
  // And no v4 deny entry may appear in both sets, or the arms are not a differential.
  for (const entry of NON_MATCHING_DENY_SET) assert.equal(denyCidrs(DENY_SET_V4).includes(entry.cidr), false);
});

test("the IPv6 spelling rows cover the mapped forms, because ALL_TRAFFIC has no ::/0 counterpart", () => {
  assert.equal(ALL_TRAFFIC_SENTINEL, "0.0.0.0/0");
  const v6ish = HTTP_TARGETS.filter((t) => t.family === "v6" || t.family === "v6-mapped");
  assert.ok(v6ish.length >= 3, "at least the dotted mapped form, the hex mapped form and a native v6 address");
  assert.ok(v6ish.some((t) => t.url.includes(`::ffff:${METADATA_V4}`)));
  assert.ok(v6ish.some((t) => t.url.includes("::ffff:a9fe:a9fe")));
  assert.ok(DENY_SET_V6.length > 0);
});

test("the raw targets probe a NON-HTTP port and hand-written bytes — an L7-only filter leaves both open", () => {
  const connect = RAW_TARGETS.find((t) => t.mode === "connect");
  const request = RAW_TARGETS.find((t) => t.mode === "request");
  assert.ok(connect && request);
  assert.notEqual(connect.port, 80);
  assert.notEqual(connect.port, 443);
  assert.equal(request.host, METADATA_V4);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Template resolution
// ─────────────────────────────────────────────────────────────────────────────

test("an omitted template resolves to the product image, never to bare base", () => {
  for (const raw of [undefined, null, "", "   ", 7]) {
    const r = resolveTemplate(raw);
    assert.equal(r.templateId, PROBE_TEMPLATE_ALIAS);
    assert.notEqual(r.templateId, BARE_BASE_TEMPLATE_ALIAS);
    assert.equal(r.source, "default-product-image");
  }
});

test("an explicit template is honoured verbatim, including bare base — and bare base is flagged", () => {
  assert.equal(resolveTemplate(" custom-image ").templateId, "custom-image");
  assert.equal(resolveTemplate("custom-image").source, "explicit");
  const bare = resolveTemplate(BARE_BASE_TEMPLATE_ALIAS);
  assert.equal(bare.templateId, BARE_BASE_TEMPLATE_ALIAS);
  assert.match(bare.note, /coreutils only/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The CIDR engine — the ABANDON question's arithmetic
// ─────────────────────────────────────────────────────────────────────────────

test("parseIpv4 accepts real dotted quads and refuses everything else", () => {
  assert.equal(parseIpv4("0.0.0.0"), 0);
  assert.equal(parseIpv4("255.255.255.255"), 4294967295);
  assert.equal(parseIpv4("169.254.169.254"), 2852039166);
  assert.equal(parseIpv4(" 10.0.0.1 "), 167772161);
  for (const bad of ["256.0.0.1", "1.2.3", "1.2.3.4.5", "a.b.c.d", "", null, undefined, "1.2.3.-4", "::1"]) {
    assert.equal(parseIpv4(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
  // ★ A LEADING ZERO IS AMBIGUOUS (octal to some resolvers) and is REFUSED rather than guessed.
  assert.equal(parseIpv4("010.0.0.1"), null);
  assert.equal(parseIpv4("169.254.169.0254"), null);
});

test("parseIpv4Cidr treats a bare address as /32 and refuses malformed prefixes", () => {
  assert.deepEqual(parseIpv4Cidr("10.0.0.1"), { base: 167772161, bits: 32 });
  assert.deepEqual(parseIpv4Cidr("0.0.0.0/0"), { base: 0, bits: 0 });
  assert.deepEqual(parseIpv4Cidr("169.254.0.0/16"), { base: parseIpv4("169.254.0.0"), bits: 16 });
  for (const bad of ["10.0.0.0/33", "10.0.0.0/", "10.0.0.0/x", "10.0.0.0/016", "nope/8", ""]) {
    assert.equal(parseIpv4Cidr(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("ipv4InCidr answers containment at every boundary, and /0 contains EVERYTHING", () => {
  assert.equal(ipv4InCidr("169.254.169.254", "169.254.0.0/16"), true);
  assert.equal(ipv4InCidr("169.253.255.255", "169.254.0.0/16"), false);
  assert.equal(ipv4InCidr("169.255.0.0", "169.254.0.0/16"), false);
  assert.equal(ipv4InCidr("10.255.255.255", "10.0.0.0/8"), true);
  assert.equal(ipv4InCidr("11.0.0.0", "10.0.0.0/8"), false);
  assert.equal(ipv4InCidr("172.31.255.255", "172.16.0.0/12"), true);
  assert.equal(ipv4InCidr("172.32.0.0", "172.16.0.0/12"), false);
  assert.equal(ipv4InCidr("10.0.0.1", "10.0.0.1"), true, "a bare address is /32");
  assert.equal(ipv4InCidr("10.0.0.2", "10.0.0.1"), false);
  // ★★★ THE /0 CASE. JavaScript shifts mod 32, so a naive mask for /0 becomes all-ones and
  // ALL_TRAFFIC would match NOTHING — the single most important deny entry inverted.
  assert.equal(ipv4InCidr("8.8.8.8", ALL_TRAFFIC_SENTINEL), true);
  assert.equal(ipv4InCidr("169.254.169.254", ALL_TRAFFIC_SENTINEL), true);
  assert.equal(ipv4InCidr("0.0.0.0", ALL_TRAFFIC_SENTINEL), true);
  // Unparseable inputs are FALSE, never a throw and never a silent true.
  assert.equal(ipv4InCidr("::1", "10.0.0.0/8"), false);
  assert.equal(ipv4InCidr("10.0.0.1", "garbage"), false);
});

test("looksLikeIpv6 and parseResolvConf read only real nameserver lines", () => {
  assert.equal(looksLikeIpv6("fd00::1"), true);
  assert.equal(looksLikeIpv6("10.0.0.1"), false);
  const conf = [
    "# Generated by the sandbox",
    "; another comment style",
    "search local",
    "nameserver 10.0.0.2",
    "  nameserver   fd00::1  ",
    "#nameserver 169.254.169.254",
    "options ndots:0",
  ].join("\n");
  assert.deepEqual(parseResolvConf(conf), ["10.0.0.2", "fd00::1"]);
  // ★ A COMMENTED-OUT NAMESERVER IS NOT THE GUEST'S RESOLVER. Reading one would answer the
  // abandon question about a line nothing uses.
  assert.equal(parseResolvConf(conf).includes(METADATA_V4), false);
  assert.deepEqual(parseResolvConf(""), []);
});

test("classifyResolvers keeps `could not decide` out of `outside`", () => {
  const v4Only = denyCidrs(DENY_SET_V4);
  const inside = classifyResolvers(["10.0.0.2"], v4Only);
  assert.equal(inside.inside.length, 1);
  assert.equal(inside.inside[0].cidr, "10.0.0.0/8");

  const outside = classifyResolvers(["8.8.8.8", "127.0.0.53"], v4Only);
  assert.equal(outside.inside.length, 0);
  assert.equal(outside.outside.length, 2);
  assert.equal(outside.undecided.length, 0);

  // An IPv6 nameserver against an IPv4-ONLY deny set is DECIDED: no v4 CIDR can contain it.
  const v6AgainstV4 = classifyResolvers(["fd00::1"], v4Only);
  assert.equal(v6AgainstV4.outside.length, 1);
  assert.match(v6AgainstV4.outside[0].why, /outside-by-family/);
  assert.equal(v6AgainstV4.undecided.length, 0);

  // ★ The same nameserver against a deny set that ALSO declares IPv6 is UNDECIDED, not safe.
  const mixed = classifyResolvers(["fd00::1"], [...v4Only, ...denyCidrs(DENY_SET_V6)]);
  assert.equal(mixed.undecided.length, 1);
  assert.equal(mixed.outside.length, 0);

  // Garbage is undecided too — never silently outside.
  const junk = classifyResolvers(["not-an-address"], v4Only);
  assert.equal(junk.undecided.length, 1);
  assert.equal(junk.outside.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The in-guest command and its parser
// ─────────────────────────────────────────────────────────────────────────────

test("buildHttpTargetCommand emits ONE command per target, ending exit 0, with no single quote", () => {
  const cmd = buildHttpTargetCommand(HTTP_TARGETS[0]);
  assert.match(cmd, /^sh -c '/);
  assert.match(cmd, /exit 0'$/);
  assert.match(cmd, /--max-time 12/);
  // `$?` must be read from the ASSIGNMENT, not through a pipe: `err=$(curl … | tr …)` would
  // make `$?` the status of `tr` and every target would report success.
  assert.match(cmd, /\)\n?; code=\$\?/);
  assert.equal(cmd.slice(7, -1).includes("'"), false);
  // Every real target builds.
  for (const t of HTTP_TARGETS) assert.ok(buildHttpTargetCommand(t).length > 0);
});

test("buildHttpTargetCommand REFUSES a target whose url would break the sh -c wrapper", () => {
  assert.throws(
    () => buildHttpTargetCommand({ id: "evil", url: "https://x/'; echo pwned; :'" }),
    ProbeCommandError,
  );
  assert.throws(() => buildHttpTargetCommand({ id: "", url: "https://x/" }), ProbeCommandError);
  assert.throws(() => buildHttpTargetCommand({ id: "x", url: "" }), ProbeCommandError);
});

test("parseProbeLine assembles a row across newlines and REJECTS a truncated one", () => {
  assert.deepEqual(parseProbeLine(`${PROBE_MARKER} metadata_v4 0 200 END\n`, "metadata_v4"), {
    id: "metadata_v4",
    exitCode: 0,
    detail: "200",
  });
  // ★ The defect that cost the sibling probe THREE runs: curl writes -w to stdout and the
  // error to stderr, and `2>&1` interleaves them into TWO lines on Linux and ONE on Windows.
  // The consumer must assemble across a newline even though the producer already flattens.
  assert.deepEqual(parseProbeLine(`${PROBE_MARKER} unresolvable 6 curl: (6) Could not\nresolve host END`, "unresolvable"), {
    id: "unresolvable",
    exitCode: 6,
    detail: "curl: (6) Could not resolve host",
  });
  // A line with no END sentinel is REJECTED rather than half-read.
  assert.equal(parseProbeLine(`${PROBE_MARKER} metadata_v4 0 200`, "metadata_v4"), null);
  assert.equal(parseProbeLine("", "metadata_v4"), null);
  // Another target's line never satisfies this one.
  assert.equal(parseProbeLine(`${PROBE_MARKER} allowed_public 0 200 END`, "metadata_v4"), null);
});

test("classifyHttpRow and blockShape keep `no row` apart from `blocked`, and 28 apart from 7", () => {
  assert.equal(classifyHttpRow(reached("x")), "reached");
  assert.equal(classifyHttpRow(timedOut("x")), "blocked");
  assert.equal(classifyHttpRow(null), "no-result");
  assert.equal(classifyHttpRow(undefined), "no-result");
  assert.equal(blockShape(timedOut("x")), "timed-out");
  assert.equal(blockShape(refused("x")), "refused-or-unrouted");
  assert.equal(blockShape(dnsFailed("x")), "dns-failure");
  assert.equal(blockShape(reached("x")), "reached");
  assert.equal(blockShape(null), "unknown");
  assert.equal(blockShape(row("x", 35)), "curl-35");
});

test("classifyRawRow reads only the declared outcome words, never prose", () => {
  assert.equal(classifyRawRow({ exitCode: 0, detail: "connected" }), "connected");
  assert.equal(classifyRawRow({ exitCode: 0, detail: "refused ECONNREFUSED" }), "refused");
  assert.equal(classifyRawRow({ exitCode: 0, detail: "timed-out after 8s" }), "timed-out");
  assert.equal(classifyRawRow({ exitCode: 0, detail: "unreachable EHOSTUNREACH" }), "unreachable");
  assert.equal(classifyRawRow({ exitCode: 0, detail: "python3: command not found" }), "unknown");
  assert.equal(classifyRawRow(null), "unknown");
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Redaction
// ─────────────────────────────────────────────────────────────────────────────

test("every secret value is replaced, and a too-short `secret` is ignored", () => {
  const key = "e2b_live_abcdefghijklmnop";
  const text = `error: request failed with ${key} in the header (${key})`;
  const out = redactSecrets(text, [key]);
  assert.equal(out.includes(key), false);
  assert.equal(out.split(REDACTION_MARKER).length - 1, 2);
  const short = "a".repeat(MIN_REDACTABLE_SECRET_LENGTH - 1);
  assert.equal(redactSecrets(`${short}bc`, [short]), `${short}bc`);
  assert.equal(redactSecrets(null, [key]), "");
  assert.equal(redactSecrets("x", [undefined, 7, null]), "x");
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The control gate — four mandatory rows, none substituting for another
// ─────────────────────────────────────────────────────────────────────────────

test("POSITIVE CONTROL: the baseline is green, and a failed allowed-public host reds it", () => {
  assert.equal(greenControls().ok, true, "the baseline fixture must be green or every negative below is vacuous");
  const bad = evaluateControls({
    policyArm: policyArm({ rows: { allowed_public: timedOut("allowed_public") } }),
    antiVacuityArm: antiVacuityArm(),
  });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.problems.map((p) => p.code), ["positive-control-failed"]);
});

test("APPARATUS CONTROL: a .invalid host that is REACHED, or missing, reds the gate", () => {
  const violated = evaluateControls({
    policyArm: policyArm({ rows: { unresolvable: reached("unresolvable") } }),
    antiVacuityArm: antiVacuityArm(),
  });
  assert.equal(violated.ok, false);
  assert.ok(violated.problems.some((p) => p.code === "apparatus-control-violated"));

  const missing = evaluateControls({
    policyArm: policyArm({ rows: { unresolvable: null } }),
    antiVacuityArm: antiVacuityArm(),
  });
  assert.equal(missing.ok, false);
  assert.ok(missing.problems.some((p) => p.code === "apparatus-control-missing"));
  // …and it is checked in BOTH arms, not only the policy one.
  const controlArmViolated = evaluateControls({
    policyArm: policyArm(),
    antiVacuityArm: antiVacuityArm({ rows: { unresolvable: reached("unresolvable") } }),
  });
  assert.equal(controlArmViolated.ok, false);
  assert.ok(controlArmViolated.problems.some((p) => p.code === "apparatus-control-violated"));
});

test("ANTI-VACUITY CONTROL: a question target BLOCKED in the non-matching arm reds the gate", () => {
  const bad = evaluateControls({
    policyArm: policyArm(),
    antiVacuityArm: antiVacuityArm({ rows: { metadata_v4: timedOut("metadata_v4") } }),
  });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.problems.map((p) => p.code), ["anti-vacuity-control-failed"]);
  assert.match(bad.problems[0].detail, /do NOT read this as enforcement/);
});

test("COMPLETENESS: a missing row and a missing arm are both refused", () => {
  const missingRow = evaluateControls({
    policyArm: policyArm({ rows: { rfc1918_10: null } }),
    antiVacuityArm: antiVacuityArm(),
  });
  assert.equal(missingRow.ok, false);
  assert.ok(missingRow.problems.some((p) => p.code === "rows-missing"));

  assert.equal(evaluateControls({ policyArm: null, antiVacuityArm: antiVacuityArm() }).ok, false);
  const noControl = evaluateControls({ policyArm: policyArm(), antiVacuityArm: { label: "N", created: false, detail: "create threw" } });
  assert.equal(noControl.ok, false);
  assert.ok(noControl.problems.some((p) => p.code === "anti-vacuity-arm-missing"));
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. (a) honoured?
// ─────────────────────────────────────────────────────────────────────────────

test("(a) YES when the denied target is unreachable under policy and reachable without it", () => {
  const v = verdictHonoured({ controls: greenControls(), policyArm: policyArm(), antiVacuityArm: antiVacuityArm() });
  assert.equal(v.state, "yes");
  assert.equal(v.reason, "denied-target-unreachable-under-policy");
});

test("(a) NO — a RESULT, not a failure — when the denied target is still reached", () => {
  const p = policyArm({ rows: { metadata_v4: reached("metadata_v4", "401") } });
  const controls = evaluateControls({ policyArm: p, antiVacuityArm: antiVacuityArm() });
  assert.equal(controls.ok, true);
  const v = verdictHonoured({ controls, policyArm: p, antiVacuityArm: antiVacuityArm() });
  assert.equal(v.state, "no");
  assert.equal(v.reason, "denied-target-still-reachable");
  assert.equal(packDisposition([v]).exitCode, 0, "a NO must keep the lane GREEN");
});

test("(a) REPORTS the IPv6 flank beside the verdict instead of folding it in", () => {
  const p = policyArm({ rows: { metadata_v4_mapped: reached("metadata_v4_mapped", "401") } });
  const v = verdictHonoured({
    controls: evaluateControls({ policyArm: p, antiVacuityArm: antiVacuityArm() }),
    policyArm: p,
    antiVacuityArm: antiVacuityArm(),
  });
  assert.equal(v.state, "yes", "an open IPv6 spelling does not unmake an enforced IPv4 deny");
  assert.match(v.detail, /open IPv6 flank/);
  assert.match(v.detail, /metadata_v4_mapped=reached/);
});

test("(a) is INCONCLUSIVE when the controls failed or the question row is missing", () => {
  const bad = evaluateControls({ policyArm: policyArm({ rows: { allowed_public: timedOut("allowed_public") } }), antiVacuityArm: antiVacuityArm() });
  assert.equal(verdictHonoured({ controls: bad, policyArm: policyArm(), antiVacuityArm: antiVacuityArm() }).state, "inconclusive");
  const p = policyArm({ rows: { metadata_v4: null } });
  // the gate catches the missing row first; force past it to prove the verdict's own guard
  const v = verdictHonoured({ controls: { ok: true, problems: [] }, policyArm: p, antiVacuityArm: antiVacuityArm() });
  assert.equal(v.state, "inconclusive");
  assert.equal(v.reason, "question-row-missing");
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. (b) read-back
// ─────────────────────────────────────────────────────────────────────────────

test("(b) YES only when getInfo materializes EXACTLY the declared set", () => {
  const declared = denyCidrs(DENY_SET_V4);
  const v = verdictReadBack({ readBack: { ok: true, denyOut: [...declared].reverse() }, declared });
  assert.equal(v.state, "yes", "order must not matter; the SET does");
  assert.equal(v.reason, "policy-materialized-exactly");
});

test("(b) a MISMATCH is `no`, not rounded up to yes — a naive read-back check would pass on it", () => {
  const declared = denyCidrs(DENY_SET_V4);
  const missing = verdictReadBack({ readBack: { ok: true, denyOut: declared.slice(1) }, declared });
  assert.equal(missing.state, "no");
  assert.equal(missing.reason, "policy-materialized-but-differs");
  assert.match(missing.detail, /MISSING: 169\.254\.0\.0\/16/);

  const extra = verdictReadBack({ readBack: { ok: true, denyOut: [...declared, "8.8.8.8/32"] }, declared });
  assert.equal(extra.state, "no");
  assert.match(extra.detail, /UNEXPECTED: 8\.8\.8\.8\/32/);
});

test("(b) NO when the info carries no denyOut at all, INCONCLUSIVE when getInfo itself failed", () => {
  const declared = denyCidrs(DENY_SET_V4);
  const none = verdictReadBack({ readBack: { ok: true, denyOut: null, network: undefined }, declared });
  assert.equal(none.state, "no");
  assert.equal(none.reason, "network-not-materialized");
  const failed = verdictReadBack({ readBack: { ok: false, detail: "TimeoutError: getInfo" }, declared });
  assert.equal(failed.state, "inconclusive");
  assert.equal(failed.reason, "getinfo-failed");
  assert.equal(verdictReadBack({ declared }).state, "inconclusive");
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. (c) ★ THE ABANDON QUESTION
// ─────────────────────────────────────────────────────────────────────────────

const resolvOk = (text) => ({ ok: true, text });

test("(c) YES — ABANDON — when a nameserver falls inside a declared deny range", () => {
  const v = verdictResolverInDenySet({
    resolvConf: resolvOk("nameserver 10.0.0.2\n"),
    denySet: DENY_SET_V4,
    dnsRow: reached("dns_dependent"),
    antiVacuityDnsRow: reached("dns_dependent"),
  });
  assert.equal(v.state, "yes");
  assert.equal(v.reason, "resolver-inside-the-deny-set");
  assert.match(v.detail, /ABANDON/);
  assert.match(v.detail, /10\.0\.0\.2 is inside 10\.0\.0\.0\/8/);
  // ★★★ AND THE LANE STAYS GREEN FOR IT. The abandon answer is a measurement, not a failure.
  assert.equal(packDisposition([v]).exitCode, 0);
  assert.equal(decideOption([v]).decision, "abandon");
});

test("(c) NO — the approach survives — when every nameserver is outside the deny set", () => {
  const v = verdictResolverInDenySet({
    resolvConf: resolvOk("nameserver 8.8.8.8\nnameserver 127.0.0.53\n"),
    denySet: DENY_SET_V4,
    dnsRow: reached("dns_dependent"),
    antiVacuityDnsRow: reached("dns_dependent"),
  });
  assert.equal(v.state, "no");
  assert.equal(v.reason, "resolver-outside-the-deny-set");
});

test("(c) the EMPIRICAL half fires independently: resolution broke under the policy", () => {
  // Resolver outside the set, and yet DNS failed under the policy while working without it.
  const v = verdictResolverInDenySet({
    resolvConf: resolvOk("nameserver 8.8.8.8\n"),
    denySet: DENY_SET_V4,
    dnsRow: dnsFailed("dns_dependent"),
    antiVacuityDnsRow: reached("dns_dependent"),
  });
  assert.equal(v.state, "yes");
  assert.equal(v.reason, "resolution-broke-under-policy-despite-resolver-outside");
  // And it fires even when resolv.conf could not be read at all.
  const blind = verdictResolverInDenySet({
    resolvConf: { ok: false, detail: "EACCES" },
    denySet: DENY_SET_V4,
    dnsRow: dnsFailed("dns_dependent"),
    antiVacuityDnsRow: reached("dns_dependent"),
  });
  assert.equal(blind.state, "yes");
  assert.equal(blind.reason, "resolution-broke-under-policy");
});

test("(c) a DNS failure in BOTH arms is not attributed to the policy", () => {
  const v = verdictResolverInDenySet({
    resolvConf: resolvOk("nameserver 8.8.8.8\n"),
    denySet: DENY_SET_V4,
    dnsRow: dnsFailed("dns_dependent"),
    antiVacuityDnsRow: dnsFailed("dns_dependent"),
  });
  assert.equal(v.state, "no", "if the control arm could not resolve either, the deny set is not the cause");
});

test("(c) an unreadable resolv.conf with no empirical failure is INCONCLUSIVE, never `safe`", () => {
  const v = verdictResolverInDenySet({
    resolvConf: { ok: false, detail: "no such file" },
    denySet: DENY_SET_V4,
    dnsRow: reached("dns_dependent"),
    antiVacuityDnsRow: reached("dns_dependent"),
  });
  assert.equal(v.state, "inconclusive");
  assert.equal(v.reason, "resolv-conf-unreadable");
  assert.notEqual(v.state, "no");
});

test("(c) an UNCLASSIFIABLE nameserver blocks the `no`, and an empty resolv.conf is inconclusive", () => {
  const v = verdictResolverInDenySet({
    resolvConf: resolvOk("nameserver 8.8.8.8\nnameserver not-an-address\n"),
    denySet: DENY_SET_V4,
    dnsRow: reached("dns_dependent"),
    antiVacuityDnsRow: reached("dns_dependent"),
  });
  assert.equal(v.state, "inconclusive");
  assert.equal(v.reason, "resolver-unclassifiable");

  const empty = verdictResolverInDenySet({
    resolvConf: resolvOk("search local\noptions ndots:0\n"),
    denySet: DENY_SET_V4,
    dnsRow: reached("dns_dependent"),
    antiVacuityDnsRow: reached("dns_dependent"),
  });
  assert.equal(empty.state, "inconclusive");
  assert.equal(empty.reason, "no-nameserver-lines");
});

test("(c) is answerable even when (a) says the policy is INERT — the structural half needs no enforcement", () => {
  const v = verdictResolverInDenySet({
    resolvConf: resolvOk("nameserver 169.254.169.253\n"),
    denySet: DENY_SET_V4,
    dnsRow: reached("dns_dependent"),
    antiVacuityDnsRow: reached("dns_dependent"),
  });
  assert.equal(v.state, "yes");
  assert.match(v.detail, /169\.254\.169\.253 is inside 169\.254\.0\.0\/16/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. (d) warm re-assert
// ─────────────────────────────────────────────────────────────────────────────

const reuseArm = (o = {}) => ({
  created: true,
  updateOk: true,
  reuseShape: "warm-resume",
  before: reached("metadata_v4", "401"),
  after: timedOut("metadata_v4"),
  ...o,
});

test("(d) YES when the target was reached before the update and blocked after it", () => {
  const v = verdictWarmReassert({ arm: reuseArm() });
  assert.equal(v.state, "yes");
  assert.match(v.detail, /paused and resumed/);
});

test("(d) NO when updateNetwork returned and the target is still reachable", () => {
  const v = verdictWarmReassert({ arm: reuseArm({ after: reached("metadata_v4", "401") }) });
  assert.equal(v.state, "no");
  assert.equal(v.reason, "update-did-not-take-effect");
});

test("(d) the arm's OWN positive control gates it: unreachable before means `after` proves nothing", () => {
  const v = verdictWarmReassert({ arm: reuseArm({ before: timedOut("metadata_v4") }) });
  assert.equal(v.state, "inconclusive");
  assert.equal(v.reason, "reuse-arm-positive-control-failed");
});

test("(d) a degraded reuse shape is REPORTED rather than over-claimed", () => {
  const v = verdictWarmReassert({
    arm: reuseArm({ reuseShape: "running-sandbox-only", reuseShapeDetail: "betaPause: 403 not available on this plan" }),
  });
  assert.equal(v.state, "yes");
  assert.match(v.detail, /still-RUNNING reused sandbox/);
  assert.match(v.detail, /do not read a resume result into it/);
});

test("(d) is INCONCLUSIVE when the arm never ran, the update threw, or a row is missing", () => {
  assert.equal(verdictWarmReassert({ arm: { created: false, detail: "create threw" } }).reason, "arm-missing");
  assert.equal(verdictWarmReassert({ arm: reuseArm({ updateOk: false, updateDetail: "404" }) }).reason, "updatenetwork-threw");
  assert.equal(verdictWarmReassert({ arm: reuseArm({ after: null }) }).reason, "reuse-rows-missing");
  assert.equal(verdictWarmReassert({}).state, "inconclusive");
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. (e) where does enforcement live?
// ─────────────────────────────────────────────────────────────────────────────

const honouredYes = { probe: "a", state: "yes", reason: "denied-target-unreachable-under-policy", detail: "" };
const honouredNo = { probe: "a", state: "no", reason: "denied-target-still-reachable", detail: "" };

test("(e) YES — packet path — when the raw targets close under the policy and open without it", () => {
  const v = verdictEnforcementLayer({
    controls: greenControls(),
    honoured: honouredYes,
    policyArm: policyArm(),
    antiVacuityArm: antiVacuityArm(),
  });
  assert.equal(v.state, "yes");
  assert.equal(v.reason, "enforcement-is-in-the-packet-path");
});

test("(e) NO — an L7 filter — when HTTP is blocked but a raw socket still connects", () => {
  const p = policyArm({ rawRows: { raw_tcp_nonhttp: { exitCode: 0, detail: "connected", tool: "python3" } } });
  const v = verdictEnforcementLayer({
    controls: evaluateControls({ policyArm: p, antiVacuityArm: antiVacuityArm() }),
    honoured: honouredYes,
    policyArm: p,
    antiVacuityArm: antiVacuityArm(),
  });
  assert.equal(v.state, "no");
  assert.equal(v.reason, "enforcement-is-not-in-the-packet-path");
  assert.match(v.detail, /Node's global fetch ignores every proxy variable/);
});

test("(e) DISSOLVES to `no` — not inconclusive — when (a) measured the policy inert", () => {
  const v = verdictEnforcementLayer({
    controls: greenControls(),
    honoured: honouredNo,
    policyArm: policyArm(),
    antiVacuityArm: antiVacuityArm(),
  });
  assert.equal(v.state, "no");
  assert.equal(v.reason, "nothing-was-blocked-so-there-is-no-layer-to-locate");
  // ★ It must NOT ask the operator to re-spend an authorised run on a dissolved question.
  assert.equal(packDisposition([honouredNo, v]).exitCode, 0);
});

test("(e) is INCONCLUSIVE when the raw rows are unusable or the control arm could not reach them", () => {
  const noTool = policyArm({ rawRows: { raw_tcp_nonhttp: { exitCode: 0, detail: "python3: not found", tool: "none" } } });
  const v = verdictEnforcementLayer({
    controls: evaluateControls({ policyArm: noTool, antiVacuityArm: antiVacuityArm() }),
    honoured: honouredYes,
    policyArm: noTool,
    antiVacuityArm: antiVacuityArm(),
  });
  assert.equal(v.state, "inconclusive");
  assert.equal(v.reason, "raw-socket-rows-unusable");

  const closedControl = antiVacuityArm({
    rawRows: {
      raw_tcp_nonhttp: { exitCode: 0, detail: "timed-out", tool: "python3" },
      raw_http_bytes: { exitCode: 0, detail: "timed-out", tool: "python3" },
    },
  });
  const v2 = verdictEnforcementLayer({
    controls: evaluateControls({ policyArm: policyArm(), antiVacuityArm: closedControl }),
    honoured: honouredYes,
    policyArm: policyArm(),
    antiVacuityArm: closedControl,
  });
  assert.equal(v2.state, "inconclusive");
  assert.equal(v2.reason, "raw-targets-unreachable-in-the-control-arm");
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Product regression
// ─────────────────────────────────────────────────────────────────────────────

test("regression NO when every exercised row is reached, YES when the deny set breaks one", () => {
  const ids = ["dns_dependent", "model_api"];
  const ok = verdictProductRegression({ controls: greenControls(), policyArm: policyArm(), exercisedIds: ids, skippedIds: [] });
  assert.equal(ok.state, "no");
  assert.equal(ok.reason, "the-deny-set-does-not-break-the-product");

  const p = policyArm({ rows: { dns_dependent: dnsFailed("dns_dependent") } });
  const broken = verdictProductRegression({
    controls: evaluateControls({ policyArm: p, antiVacuityArm: antiVacuityArm() }),
    policyArm: p,
    exercisedIds: ids,
    skippedIds: [],
  });
  assert.equal(broken.state, "yes");
  assert.equal(broken.reason, "the-deny-set-breaks-the-product");
});

test("a SKIPPED regression row is NAMED, never counted as passing", () => {
  const v = verdictProductRegression({
    controls: greenControls(),
    policyArm: policyArm(),
    exercisedIds: ["dns_dependent", "model_api"],
    skippedIds: [AOA_API_TARGET_ID],
  });
  assert.equal(v.state, "no");
  assert.match(v.detail, /NOT EXERCISED: aoa_api_url/);
  assert.match(v.detail, /PARTIAL/);
});

test("the AoA control-plane row is an operator input with a declared default", () => {
  const supplied = resolveAoaApiTarget(" https://aoa.example/ ");
  assert.equal(supplied.supplied, true);
  assert.equal(supplied.target.url, "https://aoa.example/");
  assert.equal(supplied.target.role, "product_regression");
  const absent = resolveAoaApiTarget("   ");
  assert.equal(absent.supplied, false);
  assert.equal(absent.target, null);
  assert.match(DEFAULT_AOA_API_URL, /^https:\/\//);
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Disposition and the computed stop condition
// ─────────────────────────────────────────────────────────────────────────────

test("only `inconclusive` reds the lane; `no` and the abandon `yes` are green", () => {
  const yes = { probe: "a", state: "yes", reason: "r", detail: "" };
  const no = { probe: "b", state: "no", reason: "r", detail: "" };
  const inc = { probe: "c", state: "inconclusive", reason: "why", detail: "" };
  assert.equal(packDisposition([yes, no]).exitCode, 0);
  assert.equal(packDisposition([yes, no]).disposition, "measured");
  assert.equal(packDisposition([yes, no, inc]).exitCode, 1);
  assert.match(packDisposition([yes, no, inc]).detail, /c \(why\)/);
  assert.equal(packDisposition([]).exitCode, 1);
  assert.equal(packDisposition(undefined).disposition, "inconclusive");
  assert.match(formatVerdict(yes), /PROBE a: YES — r/);
});

test("decideOption computes the STOP CONDITION so five verdicts cannot be mis-skimmed", () => {
  const v = (probe, state) => ({ probe, state, reason: "r", detail: "" });
  // (c) yes outranks everything: the option is abandoned even if (a) and (b) are yes.
  assert.equal(decideOption([v("a", "yes"), v("b", "yes"), v("c", "yes")]).decision, "abandon");
  assert.equal(decideOption([v("a", "yes"), v("b", "yes"), v("c", "yes")]).because, "resolver-or-resolution-is-inside-the-deny-set");
  // An inert deny set abandons too.
  assert.equal(decideOption([v("a", "no"), v("c", "no")]).because, "denyout-is-inert-at-this-tier");
  // Enforced but unverifiable is ABANDON, not viable: a self-hosted API could ignore the field.
  assert.equal(decideOption([v("a", "yes"), v("b", "no"), v("c", "no")]).because, "unverifiable");
  // Enforced, verifiable, and it breaks the product.
  assert.equal(
    decideOption([v("a", "yes"), v("b", "yes"), v("c", "no"), v("regression", "yes")]).decision,
    "blocked-on-regression",
  );
  // Enforced, verifiable, packet path → viable.
  const viable = decideOption([v("a", "yes"), v("b", "yes"), v("c", "no"), v("e", "yes"), v("regression", "no")]);
  assert.equal(viable.decision, "viable");
  assert.equal(viable.because, "enforced-verifiable-and-in-the-packet-path");
  // Enforced and verifiable but only at L7 — still viable, with the caveat in the detail.
  const l7 = decideOption([v("a", "yes"), v("b", "yes"), v("c", "no"), v("e", "no"), v("regression", "no")]);
  assert.equal(l7.decision, "viable");
  assert.match(l7.detail, /enforcement is at L7/);
  assert.equal(decideOption([]).decision, "undecided");
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. The durable record
// ─────────────────────────────────────────────────────────────────────────────

test("buildProbeRecord REFUSES a record that cannot be interpreted later", () => {
  const verdicts = [{ probe: "a", state: "no", reason: "r", detail: "d" }];
  assert.throws(() => buildProbeRecord({ verdicts, denySet: DENY_SET_V4 }), ProbeRecordError);
  assert.throws(() => buildProbeRecord({ verdicts, template: "   ", denySet: DENY_SET_V4 }), ProbeRecordError);
  // ★ AND WITHOUT THE DENY SET: a reachability result means nothing without the policy it
  // was measured against — the same targets under a different set are a different experiment.
  assert.throws(() => buildProbeRecord({ verdicts, template: PROBE_TEMPLATE_ALIAS }), ProbeRecordError);
  assert.throws(() => buildProbeRecord({ verdicts, template: PROBE_TEMPLATE_ALIAS, denySet: [] }), ProbeRecordError);
});

test("buildProbeRecord carries every verdict's state AND reason, the template, the deny set and the decision", () => {
  const verdicts = [
    { probe: "a", state: "no", reason: "denied-target-still-reachable", detail: "d1" },
    { probe: "c", state: "no", reason: "resolver-outside-the-deny-set", detail: "d2" },
  ];
  const rec = buildProbeRecord({
    verdicts,
    template: PROBE_TEMPLATE_ALIAS,
    templateSource: "default-product-image",
    templateNote: "n",
    denySet: DENY_SET_V4,
    commitSha: "abc123",
    runNonce: "W10B-XYZ",
    generatedAt: "2026-09-07T00:00:00Z",
    workflowRunUrl: "https://example/run/1",
    observations: { resolvers: ["8.8.8.8"] },
  });
  assert.equal(rec.schema, PROBE_RECORD_SCHEMA);
  assert.equal(rec.template.resolved, PROBE_TEMPLATE_ALIAS);
  assert.deepEqual(rec.denySet, denyCidrs(DENY_SET_V4));
  assert.equal(rec.commitSha, "abc123");
  assert.equal(rec.disposition.disposition, "measured");
  assert.equal(rec.decision.because, "denyout-is-inert-at-this-tier");
  assert.deepEqual(rec.probes.map((p) => `${p.probe}=${p.state}/${p.reason}`), [
    "a=no/denied-target-still-reachable",
    "c=no/resolver-outside-the-deny-set",
  ]);
  assert.deepEqual(rec.observations.resolvers, ["8.8.8.8"]);
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. THE LANE'S OWN GUARDS, ASSERTED AGAINST THE REAL YAML
// ─────────────────────────────────────────────────────────────────────────────

test("evaluateDurableRecord finds every violation it exists to find", () => {
  // ★ NORMALISED TO LF BEFORE ANY MUTATION, AND THAT IS NOT COSMETIC. This repo stores the
  // workflow with LF in the index but checks it out CRLF on Windows (`git ls-files --eol`:
  // `i/lf w/crlf`). A `$`-anchored mutation like /^(\s*)exit 1$/m then matches NOTHING,
  // because `\r` sits between `exit 1` and the newline — so the mutation would silently fail
  // to land and the negative case would pass for the wrong reason on one platform and the
  // right reason on the other. That is the sibling probe's own lesson ("a dry-run on a
  // different platform is not a control for the real one") turned on this file's mutations.
  // `evaluateDurableRecord` itself splits on /\r?\n/, so it reads either form.
  const base = readFileSync(WORKFLOW_PATH, "utf8").replace(/\r\n/g, "\n");
  // POSITIVE CONTROL FIRST: the real lane is clean. Without this the negatives below could
  // all be passing for the wrong reason.
  assert.deepEqual(evaluateDurableRecord(base).violations, []);

  // Drop the upload's `if: always()`.
  const unguardedUpload = base.replace(/uses: actions\/upload-artifact[^\n]*\n(\s*)if: always\(\)\n/, (m) => m.replace(/\n\s*if: always\(\)\n/, "\n"));
  assert.notEqual(unguardedUpload, base, "the mutation must actually change the text");
  assert.ok(evaluateDurableRecord(unguardedUpload).violations.some((v) => v.code === "record-upload-unguarded"));

  // Remove the upload step entirely.
  const noUpload = base.replace(/uses: actions\/upload-artifact[^\n]*/, "uses: actions/checkout@v4");
  assert.ok(evaluateDurableRecord(noUpload).violations.some((v) => v.code === "record-upload-missing"));

  // Point the shell fallback's default at bare `base`.
  const wrongTemplate = base.replace(/W10B_DEFAULT_TEMPLATE: aoa-base/, "W10B_DEFAULT_TEMPLATE: base");
  assert.notEqual(wrongTemplate, base);
  assert.ok(evaluateDurableRecord(wrongTemplate).violations.some((v) => v.code === "default-template-mismatch"));

  // Remove the keyless positive control's `exit 1`.
  const noSkipGuard = base.replace(/^(\s*)exit 1$/m, "$1echo would-have-failed");
  assert.notEqual(noSkipGuard, base);
  assert.ok(evaluateDurableRecord(noSkipGuard).violations.some((v) => v.code === "skip-positive-control-missing"));

  // A workflow with none of it at all reports every violation.
  const empty = evaluateDurableRecord("name: nothing\njobs:\n  x:\n    steps: []\n").violations.map((v) => v.code).sort();
  assert.deepEqual(empty, [
    "default-template-undeclared",
    "record-fallback-missing",
    "record-upload-missing",
    "skip-positive-control-missing",
  ]);
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. THE STALE-PREMISE CORRECTION, PINNED
// ─────────────────────────────────────────────────────────────────────────────

test("the provider runtime no longer books managed-E2B egress as unlockable without qualification", () => {
  // ★★★ THE SINGLE LINE THIS UNIT WAS OPENED BY. `sandbox-provider-runtime.ts`'s
  // `acquireLease` comment used to read "(§11/§12: managed E2B egress is not fully
  // lockable)" as a bare statement of fact, and it is the line a future engineer actually
  // reads before deciding whether a provider-level control is possible. Against the
  // installed, lockfile-pinned e2b@2.30.5 that claim is false as a statement about the
  // SEAM: `SandboxOpts.network` with allowOut/denyOut exists, reaches the POST body, and is
  // read back by getInfo(). What is unmeasured is ENFORCEMENT, which is W10B's subject.
  //
  // This test pins the correction so nobody restores the unqualified claim silently.
  //
  // ★★ THE ASSERTION IS ABOUT THE PROPERTY, NOT ABOUT WHO WROTE IT. Sibling unit W10A
  // (branch `replatform/w10a-e2b-lockable-premise`) corrects the same comment for the same
  // reason and files E8-F007 against the stale wording; whichever text survives the merge,
  // the invariant this guard exists for is identical. Requiring the literal string "W10B"
  // would have turned a real invariant into a territorial claim that reds the moment the
  // better-owned text wins — so the pointer clause accepts either unit's id.
  const text = readFileSync(PROVIDER_RUNTIME_PATH, "utf8");
  assert.ok(
    /W10B|E8-F007/.test(text),
    "sandbox-provider-runtime.ts must point at the measurement (W10B's probe, or E8-F007's finding against the stale wording) where it discusses egress lockability, so the next reader finds it instead of the stale premise",
  );
  assert.ok(
    /SandboxOpts\.network/.test(text),
    "the correction must NAME the seam that exists and was never called; a vague hedge would leave the option booked as unavailable",
  );
  assert.equal(
    /not fully lockable\)/.test(text),
    false,
    "the bare, unqualified claim must not return: it is what kept the only enforcement layer outside the guest booked as unavailable",
  );
});
