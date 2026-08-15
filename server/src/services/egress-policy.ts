// server/src/services/egress-policy.ts
//
// DAT-005 D1 — the PURE, server-side default-deny egress destination classifier.
//
// `classifyEgressDestination(requestedUrl, resolvedAddrs, policy, controlPlane?)`
// decides `'allow'` or one of the FROZEN `NETWORK_DENIAL_CLASSES`
// (`metadata | private | control_plane | not_allowlisted`) — the closed vocabulary
// the frozen `network_denied` wire event carries. It is a PURE function of its
// inputs (no I/O, no clock): the proxy (D2) resolves the host first and hands the
// resolved addresses in, and the `policy`-lane vectors gate (D5) re-derives the
// same decision independently.
//
// Layered default-deny (each independent, fail-closed):
//   1. Allowlist gate — the destination is admitted ONLY if the URL is `https`,
//      its host is a member of `policy.allow`, and its port matches that rule.
//      Everything else (non-https, wrong port, unknown host, unparseable) is
//      `not_allowlisted`. `outbound-url-guard` is a BLOCKLIST; this is the positive
//      allowlist the frozen `networkPolicyV1Schema` (`defaultAction: 'deny'`) implies.
//   2. IP-range gate — reject if ANY resolved address is in a deny range. Unlike
//      `outbound-url-guard`'s multi-homed FILTER-and-keep-public, DAT-005 denies the
//      whole request when any resolved address is unsafe (DNS-rebind: an attacker who
//      controls DNS returns `[public, private]` and connects to the private one). The
//      classes, by precedence: `metadata` (cloud IMDS) > `control_plane`
//      (config-sourced) > `private` (RFC1918/loopback/link-local via
//      `outbound-url-guard.isPrivateIP`). An unverifiable/empty resolution is a
//      fail-closed `private` (we cannot prove the destination is public).
//
// The control-plane deny set is CONFIG-SOURCED (`resolveControlPlaneDenySet`, env
// `AOA_CONTROL_PLANE_DENY_CIDRS`), never hardcoded incidentally — the control plane
// may have a PUBLIC address that `isPrivateIP` would not catch, so this is the only
// gate standing between an SSRF and the control plane. Cloud metadata addresses are
// the well-known industry constants (IMDS 169.254.169.254, ECS 169.254.170.2, IPv6
// IMDS fd00:ec2::254), which `isPrivateIP` ALSO catches as link-local — so a missed
// metadata match still fails closed as `private`.
//
// Server-side ONLY: `outbound-url-guard` lives in `server/src` and is
// boundary-forbidden to the worker-daemon (E4-D01).

import {
  NETWORK_DENIAL_CLASSES,
  type NetworkDeniedPayloadV1,
  type NetworkPolicyV1,
} from "@armyofagents/worker-protocol";
import { isPrivateIP } from "./outbound-url-guard.js";

/** The frozen network-denial destination classes (`NETWORK_DENIAL_CLASSES`). */
export type NetworkDenialClass = NetworkDeniedPayloadV1["destinationClass"];
export type EgressClassification = "allow" | NetworkDenialClass;

/** The config-sourced control-plane deny ranges (CIDRs or bare IP literals). */
export interface ControlPlaneDenySet {
  readonly cidrs: readonly string[];
}

/**
 * Well-known cloud metadata endpoints (industry constants, not deployment config).
 * `isPrivateIP` also catches 169.254.0.0/16 as link-local, so these only make the
 * REPORTED class more specific; a miss still fails closed as `private`.
 */
const METADATA_DENY_CIDRS: readonly string[] = [
  "169.254.169.254/32", // AWS/GCP/Azure/OpenStack IMDS
  "169.254.170.2/32", // AWS ECS task metadata
  "fd00:ec2::254/128", // AWS IMDS over IPv6
];

const DENY_SEVERITY: Record<NetworkDenialClass, number> = {
  metadata: 4,
  control_plane: 3,
  private: 2,
  not_allowlisted: 1,
};

// --- IP parsing + CIDR matching (pure, family-aware) -------------------------

interface ParsedIp {
  readonly family: 4 | 6;
  readonly value: bigint;
}

function parseIpv4(ip: string): bigint | null {
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

/** Parse an IPv6 address into its 128-bit value, or null. Handles `::`
 * compression, a `%zone` suffix, brackets, and `::ffff:1.2.3.4` mapped form
 * (which is normalized to IPv4 by {@link parseIp}, not here). */
function parseIpv6Value(ip: string): bigint | null {
  const normalized = ip.replace(/^\[|\]$/g, "").split("%", 1)[0]!;
  if (!normalized.includes(":")) return null;
  const halves = normalized.split("::");
  if (halves.length > 2) return null;

  const parseHalf = (value: string): number[] | null => {
    if (!value) return [];
    const words: number[] = [];
    for (const token of value.split(":")) {
      // Allow a trailing embedded IPv4 (e.g. `::ffff:1.2.3.4`) → two words.
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

  const left = parseHalf(halves[0] ?? "");
  const right = parseHalf(halves[1] ?? "");
  if (!left || !right) return null;
  let words: number[];
  if (halves.length === 1) {
    if (left.length !== 8) return null;
    words = left;
  } else {
    const omitted = 8 - left.length - right.length;
    if (omitted < 1) return null;
    words = [...left, ...Array<number>(omitted).fill(0), ...right];
  }
  if (words.length !== 8) return null;
  let value = 0n;
  for (const word of words) value = (value << 16n) | BigInt(word & 0xffff);
  return value;
}

/** Parse an IP literal, unwrapping IPv4-mapped IPv6 (`::ffff:x.x.x.x`) to IPv4 so
 * a mapped address is classified with the same authority as its IPv4 form. */
export function parseIp(ip: string): ParsedIp | null {
  const trimmed = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%", 1)[0]!;
  const mapped = trimmed.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) {
    const v4 = parseIpv4(mapped[1]!);
    return v4 === null ? null : { family: 4, value: v4 };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) {
    const v4 = parseIpv4(trimmed);
    return v4 === null ? null : { family: 4, value: v4 };
  }
  const v6 = parseIpv6Value(trimmed);
  if (v6 === null) return null;
  // Canonicalize EVERY IPv4-mapped IPv6 form to family-4. The dotted spelling was
  // unwrapped above, but the HEX spelling (`::ffff:a9fe:a9fe`) reaches here as a
  // 128-bit value whose top 96 bits are `::ffff` (`value >> 32 === 0xffff`). Re-emit
  // it as IPv4 so the family-aware CIDR checks (metadata/control_plane) and
  // `isPrivateIP` treat a mapped address with the SAME authority as its IPv4 form —
  // closing the family asymmetry that would otherwise let a hex-mapped PUBLIC
  // control-plane IP evade the family-4 control_plane gate (isPrivateIP does not
  // catch a public control-plane address).
  if ((v6 >> 32n) === 0xffffn) return { family: 4, value: v6 & 0xffffffffn };
  return { family: 6, value: v6 };
}

/** True iff `ip` falls inside `cidr` (a CIDR block or a bare IP literal treated as
 * a host route). Families must match. */
export function ipInCidr(ip: string, cidr: string): boolean {
  const parsedIp = parseIp(ip);
  if (!parsedIp) return false;
  const slash = cidr.indexOf("/");
  const baseStr = slash === -1 ? cidr : cidr.slice(0, slash);
  const parsedBase = parseIp(baseStr.trim());
  if (!parsedBase) return false;
  if (parsedIp.family !== parsedBase.family) return false;
  const bits = parsedIp.family === 4 ? 32 : 128;
  let prefix: number;
  if (slash === -1) {
    prefix = bits;
  } else {
    const raw = Number(cidr.slice(slash + 1));
    if (!Number.isInteger(raw) || raw < 0 || raw > bits) return false;
    prefix = raw;
  }
  if (prefix === 0) return true;
  const shift = BigInt(bits - prefix);
  return (parsedIp.value >> shift) === (parsedBase.value >> shift);
}

function inAnyCidr(ip: string, cidrs: readonly string[]): boolean {
  for (const cidr of cidrs) {
    if (cidr && ipInCidr(ip, cidr)) return true;
  }
  return false;
}

// --- The per-address classification + the public classifier ------------------

function classifyAddress(addr: string, controlPlane: ControlPlaneDenySet): NetworkDenialClass | null {
  // Unparseable resolved address → cannot confirm public → fail-closed deny.
  if (!parseIp(addr)) return "private";
  if (inAnyCidr(addr, METADATA_DENY_CIDRS)) return "metadata";
  if (inAnyCidr(addr, controlPlane.cidrs)) return "control_plane";
  if (isPrivateIP(addr)) return "private";
  return null;
}

/** True iff `url` is https, its host is a member of `policy.allow`, and its port
 * matches that rule. `not_allowlisted` otherwise (parse failures included). */
function isAllowlisted(url: string, policy: NetworkPolicyV1): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const port = parsed.port === "" ? 443 : Number(parsed.port);
  if (!Number.isInteger(port)) return false;
  return policy.allow.some((rule) => rule.scheme === "https" && rule.host === host && rule.port === port);
}

/**
 * THE pure default-deny egress destination decision (D1). Returns `'allow'` or the
 * frozen denial class. `controlPlane` defaults to the empty set (the pure fn stays
 * deterministic — the proxy passes `resolveControlPlaneDenySet()`, the vectors gate
 * passes the fixture's set).
 */
export function classifyEgressDestination(
  requestedUrl: string,
  resolvedAddrs: readonly string[],
  policy: NetworkPolicyV1,
  controlPlane: ControlPlaneDenySet = { cidrs: [] },
): EgressClassification {
  // 1. Allowlist gate (host/scheme/port). A non-allowlisted destination is refused
  //    regardless of where it resolves — the default-deny posture.
  if (!isAllowlisted(requestedUrl, policy)) return "not_allowlisted";

  // 2. IP-range gate. Deny if ANY resolved address is unsafe; an empty/unverifiable
  //    resolution is fail-closed `private`.
  if (resolvedAddrs.length === 0) return "private";
  let worst: NetworkDenialClass | null = null;
  for (const addr of resolvedAddrs) {
    const cls = classifyAddress(addr, controlPlane);
    if (cls && (worst === null || DENY_SEVERITY[cls] > DENY_SEVERITY[worst])) worst = cls;
  }
  return worst ?? "allow";
}

/**
 * Resolve the config-sourced control-plane deny set from the environment. The
 * `AOA_CONTROL_PLANE_DENY_CIDRS` var is a comma/whitespace-separated list of CIDRs
 * or bare IP literals (the control plane's own address(es) that must never be an
 * egress destination). Absent → empty (no config-driven control-plane denial;
 * metadata + private still apply).
 */
export function resolveControlPlaneDenySet(
  env: Record<string, string | undefined> = process.env,
): ControlPlaneDenySet {
  const raw = env.AOA_CONTROL_PLANE_DENY_CIDRS ?? "";
  const cidrs = raw
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return { cidrs };
}

/** Re-exported for the vectors gate's dual-driven contract (D5). */
export { NETWORK_DENIAL_CLASSES };
