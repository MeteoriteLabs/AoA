#!/usr/bin/env node
/**
 * check-egress-policy-vectors.mjs
 *
 * Independent reference verifier for the DAT-005 egress-policy fixture
 * `tests/fixtures/egress-policy/v1/vectors.json`. It owns a THIRD, from-scratch
 * re-derivation of the default-deny egress destination DECISION — the allowlist
 * gate (https + host + port), the IP-range block (RFC1918/loopback/link-local),
 * the config-sourced control-plane deny set, cloud metadata, and the DNS-rebind
 * "deny if ANY resolved address is unsafe" rule — mirroring but NOT importing the
 * real `classifyEgressDestination` (`server/src/services/egress-policy.ts`).
 * Because two independent implementations pin to ONE fixture, neither can silently
 * diverge on which destinations are admitted and which class refuses them.
 *
 * The decision is pure — no DNS, no clock; the fixture supplies the resolved
 * addresses, the allowlist, and the control-plane CIDRs.
 *
 * The helpers are exported for the dependency-free node:test corpus
 * (`check-egress-policy-vectors.test.mjs`).
 *
 * Usage:
 *   node scripts/check-egress-policy-vectors.mjs
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const FIXTURE_SEGMENTS = ["tests", "fixtures", "egress-policy", "v1", "vectors.json"];

/** The FROZEN denial-class vocabulary (`NETWORK_DENIAL_CLASSES`), re-stated here. */
export const NETWORK_DENIAL_CLASSES = ["metadata", "private", "control_plane", "not_allowlisted"];

/** Well-known cloud metadata endpoints (industry constants). */
const METADATA_CIDRS = ["169.254.169.254/32", "169.254.170.2/32", "fd00:ec2::254/128"];

const DENY_SEVERITY = { metadata: 4, control_plane: 3, private: 2, not_allowlisted: 1 };

export class EgressPolicyVectorError extends Error {}

// --- Independent IP parsing + CIDR matching ----------------------------------

function parseIpv4(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

function parseIpv6(ip) {
  const norm = ip.replace(/^\[|\]$/g, "").split("%", 1)[0];
  if (!norm.includes(":")) return null;
  const halves = norm.split("::");
  if (halves.length > 2) return null;
  const half = (v) => {
    if (!v) return [];
    const words = [];
    for (const token of v.split(":")) {
      if (token.includes(".")) {
        const v4 = parseIpv4(token);
        if (v4 === null) return null;
        words.push(Number((v4 >> 16n) & 0xffffn), Number(v4 & 0xffffn));
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(token)) return null;
      words.push(Number.parseInt(token, 16));
    }
    return words;
  };
  const left = half(halves[0] ?? "");
  const right = half(halves[1] ?? "");
  if (!left || !right) return null;
  let words;
  if (halves.length === 1) {
    if (left.length !== 8) return null;
    words = left;
  } else {
    const omitted = 8 - left.length - right.length;
    if (omitted < 1) return null;
    words = [...left, ...Array(omitted).fill(0), ...right];
  }
  if (words.length !== 8) return null;
  let value = 0n;
  for (const w of words) value = (value << 16n) | BigInt(w & 0xffff);
  return value;
}

/** Parse an IP literal → { family, value } (IPv4-mapped IPv6 → IPv4), or null. */
export function parseIp(ip) {
  const t = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%", 1)[0];
  const mapped = t.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) {
    const v4 = parseIpv4(mapped[1]);
    return v4 === null ? null : { family: 4, value: v4 };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(t)) {
    const v4 = parseIpv4(t);
    return v4 === null ? null : { family: 4, value: v4 };
  }
  const v6 = parseIpv6(t);
  if (v6 === null) return null;
  // Canonicalize the HEX IPv4-mapped form (`::ffff:<hex>:<hex>`) to family-4, matching
  // the real classifier's parseIp — otherwise the reference would silently ALLOW a
  // mapped metadata/RFC1918/control-plane address the real classifier denies.
  if ((v6 >> 32n) === 0xffffn) return { family: 4, value: v6 & 0xffffffffn };
  return { family: 6, value: v6 };
}

export function ipInCidr(ip, cidr) {
  const pi = parseIp(ip);
  if (!pi) return false;
  const slash = cidr.indexOf("/");
  const base = parseIp((slash === -1 ? cidr : cidr.slice(0, slash)).trim());
  if (!base || base.family !== pi.family) return false;
  const bits = pi.family === 4 ? 32 : 128;
  let prefix = bits;
  if (slash !== -1) {
    prefix = Number(cidr.slice(slash + 1));
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return false;
  }
  if (prefix === 0) return true;
  const shift = BigInt(bits - prefix);
  return (pi.value >> shift) === (base.value >> shift);
}

function inAny(ip, cidrs) {
  return cidrs.some((c) => c && ipInCidr(ip, c));
}

/** Independent RFC1918/loopback/link-local/reserved private-range check. */
export function isPrivateIp(ip) {
  const pi = parseIp(ip);
  if (!pi) return false;
  if (pi.family === 4) {
    const v = pi.value;
    const inV4 = (cidr) => ipInCidr(ip, cidr);
    return (
      inV4("0.0.0.0/8") ||
      inV4("10.0.0.0/8") ||
      inV4("100.64.0.0/10") ||
      inV4("127.0.0.0/8") ||
      inV4("169.254.0.0/16") ||
      inV4("172.16.0.0/12") ||
      inV4("192.0.0.0/24") ||
      inV4("192.0.2.0/24") ||
      inV4("192.88.99.0/24") ||
      inV4("192.168.0.0/16") ||
      inV4("198.18.0.0/15") ||
      inV4("198.51.100.0/24") ||
      inV4("203.0.113.0/24") ||
      v >= 0xe0000000n // 224.0.0.0/3 multicast + reserved
    );
  }
  return (
    ipInCidr(ip, "::/16") || // first word zero: ::, ::1 (loopback), IPv4-compatible ::a.b.c.d
    ipInCidr(ip, "fc00::/7") ||
    ipInCidr(ip, "fe80::/10") ||
    ipInCidr(ip, "fec0::/10") ||
    ipInCidr(ip, "ff00::/8") ||
    ipInCidr(ip, "2001:db8::/32") ||
    ipInCidr(ip, "2002::/16")
  );
}

function classifyAddress(addr, controlPlaneCidrs) {
  if (!parseIp(addr)) return "private";
  if (inAny(addr, METADATA_CIDRS)) return "metadata";
  if (inAny(addr, controlPlaneCidrs)) return "control_plane";
  if (isPrivateIp(addr)) return "private";
  return null;
}

function isAllowlisted(url, allow) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const port = parsed.port === "" ? 443 : Number(parsed.port);
  if (!Number.isInteger(port)) return false;
  return allow.some((r) => r.host === host && Number(r.port) === port);
}

/** THE independent egress classification. Mirrors `classifyEgressDestination`. */
export function classifyEgress(requestedUrl, resolvedAddrs, allow, controlPlaneCidrs) {
  if (!isAllowlisted(requestedUrl, allow)) return "not_allowlisted";
  if (!Array.isArray(resolvedAddrs) || resolvedAddrs.length === 0) return "private";
  let worst = null;
  for (const addr of resolvedAddrs) {
    const cls = classifyAddress(addr, controlPlaneCidrs);
    if (cls && (worst === null || DENY_SEVERITY[cls] > DENY_SEVERITY[worst])) worst = cls;
  }
  return worst ?? "allow";
}

export function verifyFixture(fixture) {
  const problems = [];
  if (fixture?.version !== "1") problems.push(`version must be "1", got ${JSON.stringify(fixture?.version)}`);
  if (fixture?.schema !== "aoa-egress-policy-vectors/v1") problems.push("schema id mismatch");
  const ctx = fixture?.context;
  if (typeof ctx !== "object" || ctx === null) problems.push("context missing");
  const allow = Array.isArray(ctx?.allow) ? ctx.allow : null;
  const controlPlaneCidrs = Array.isArray(ctx?.controlPlaneCidrs) ? ctx.controlPlaneCidrs : null;
  if (!allow) problems.push("context.allow must be an array");
  if (!controlPlaneCidrs) problems.push("context.controlPlaneCidrs must be an array");

  const allows = Array.isArray(fixture?.allowVectors) ? fixture.allowVectors : null;
  const denies = Array.isArray(fixture?.denyVectors) ? fixture.denyVectors : null;
  if (!allows || allows.length === 0) problems.push("allowVectors must be a non-empty array");
  if (!denies || denies.length === 0) problems.push("denyVectors must be a non-empty array");

  const seen = new Set();
  for (const [i, v] of (allows ?? []).entries()) {
    const label = v?.name ?? `#${i}`;
    if (!v?.name || seen.has(v.name)) problems.push(`allow vector ${label}: missing or duplicate name`);
    seen.add(v?.name);
    const decision = classifyEgress(v.requestedUrl, v.resolvedAddrs, allow ?? [], controlPlaneCidrs ?? []);
    if (decision !== "allow") {
      problems.push(`allow vector ${label}: reference decided ${decision}, expected allow`);
    }
  }

  for (const [i, r] of (denies ?? []).entries()) {
    const label = r?.name ?? `#${i}`;
    if (!r?.name || seen.has(r.name)) problems.push(`deny vector ${label}: missing or duplicate name`);
    seen.add(r?.name);
    if (typeof r?.class !== "string") { problems.push(`deny vector ${label}: missing class`); continue; }
    if (!NETWORK_DENIAL_CLASSES.includes(r.class)) problems.push(`deny vector ${label}: class ${r.class} not a frozen NETWORK_DENIAL_CLASS`);
    const decision = classifyEgress(r.requestedUrl, r.resolvedAddrs, allow ?? [], controlPlaneCidrs ?? []);
    if (decision === "allow") {
      problems.push(`deny vector ${label}: reference ALLOWED a destination that must be refused`);
    } else if (decision !== r.class) {
      problems.push(`deny vector ${label}: reference decided ${decision}, expected ${r.class}`);
    }
  }

  if (problems.length > 0) {
    throw new EgressPolicyVectorError(`egress-policy fixture invalid:\n - ${problems.join("\n - ")}`);
  }
  return { allows: allows.length, denies: denies.length };
}

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function loadFixture(root = repoRoot()) {
  return JSON.parse(fs.readFileSync(path.join(root, ...FIXTURE_SEGMENTS), "utf8"));
}

function main() {
  let fixture;
  try {
    fixture = loadFixture();
  } catch (error) {
    console.error(`egress-policy vectors: FAIL — cannot read/parse fixture: ${error.message}`);
    process.exit(1);
  }
  try {
    const { allows, denies } = verifyFixture(fixture);
    console.log(`egress-policy vectors: PASS (${allows} allow vectors, ${denies} deny vectors)`);
  } catch (error) {
    console.error(`egress-policy vectors: FAIL — ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
