// server/src/services/w10c-internal-range-deny-set.ts
//
// W10C — THE PINNED INTERNAL-RANGE DENY SET, AS A PURE MODULE.
//
// This module is DATA + PURE FUNCTIONS. It wires nothing, enforces nothing, and
// is referenced by no call site. A later unit applies it (to the provider-layer
// network body); that wiring is deliberately separate so this set can be reviewed
// on its own merits first.
//
// -- WHY THIS SET EXISTS AT ALL -----------------------------------------------
// The repo's authority on "is this address internal" is `isPrivateIP`
// (./outbound-url-guard.ts). It is a boolean PREDICATE over an IP string, not a
// CIDR list. Anything applied OUTSIDE our process -- a provider network body, a
// firewall rule -- needs a CIDR list. Transcribing a predicate into a list by hand
// is how divergent private-range tables get born; this tree already has three
// (see the DIVERGENCE LEDGER below).
//
// So this array is NOT hand-copied. It is the MECHANICALLY DERIVED exact minimal
// CIDR cover of `isPrivateIP`'s own IPv4 rejection set (a full 2^24 sweep of the
// /24 space) and of its IPv6 rejection set (a recursive uniformity descent over
// the leading words). `w10c-internal-range-deny-set.test.ts` RE-DERIVES the IPv4
// cover from `isPrivateIP` on every CI run and asserts equality, so the two
// cannot drift apart silently: editing `isPrivateIP` reds this module's test.
//
// -- DIVERGENCE LEDGER (measured 2026-09-07, not assumed) ---------------------
// Four representations of "internal range" already exist in the tree:
//
//   1. `isPrivateIP` (server/src/services/outbound-url-guard.ts:71) -- THE
//      reference predicate. Prefix-string + IPv6 word-mask checks.
//   2. `isPrivateIp` (scripts/check-egress-policy-vectors.mjs:138) -- a
//      deliberately INDEPENDENT CIDR reimplementation used as the differential
//      oracle for the egress-policy vectors gate. MEASURED: its IPv4 half agrees
//      with `isPrivateIP` on all 2^24 /24 blocks -- zero divergence. It is NOT
//      reused here on purpose: importing the oracle into the code it checks would
//      destroy its independence.
//   3. `blockedIpv4`/`blockedIpv6` (server/src/services/mcp-connector-oauth.ts:11)
//      -- node `BlockList` tables for OAuth-metadata SSRF. MEASURED DIVERGENCE:
//      missing `192.88.99.0/24` (deprecated 6to4 relay anycast), which
//      `isPrivateIP` DOES reject. Exactly one /24 of disagreement across the whole
//      IPv4 space. Real, low-severity, and NOT fixed by this unit -- editing a live
//      SSRF table is a behaviour change, and this unit changes no behaviour.
//   4. `METADATA_DENY_CIDRS` (server/src/services/egress-policy.ts:60) -- NOT a
//      private-range table. Three cloud-metadata host routes whose only job is to
//      make the REPORTED denial class more specific. Not a peer of this set.
//
// This module is therefore a fifth FILE but not a fifth POLICY: it is a derived
// rendering of representation (1), regenerated and pinned in CI.
//
// -- THE ONE DELIBERATE DIVERGENCE FROM `isPrivateIP` -------------------------
// MEASURED: `isPrivateIP('::169.254.169.254') === false`. That is a PARSER
// defect, not a range-coverage gap -- `isPrivateIP`'s `parseIpv6Words` rejects the
// IPv4-compatible IPv6 spelling `::a.b.c.d` (its per-token regex forbids dots), so
// the address never reaches the range checks at all. The address's actual value
// has a zero leading word, so `::/16` in this set covers it, and
// `egress-policy.ts`'s `parseIp` (which DOES accept an embedded dotted quad)
// resolves it that way. This set is therefore a STRICT SUPERSET of `isPrivateIP`:
// it covers the address that has already bitten. Kept as a superset deliberately --
// a deny set that is wider than the predicate fails CLOSED.

import { ipInCidr } from "./egress-policy.js";
import { isPrivateIP } from "./outbound-url-guard.js";

/**
 * The exact minimal CIDR cover of `isPrivateIP`'s IPv4 rejection set.
 * Derived by sweeping all 2^24 /24 blocks; re-derived and pinned in CI.
 */
export const INTERNAL_RANGE_DENY_CIDRS_V4: readonly string[] = Object.freeze([
  // "This network" / unspecified. Denying this WOULD block `0.0.0.0` and `0.x.y.z`,
  // which some stacks route to the local host -- a loopback reach in disguise.
  "0.0.0.0/8",
  // RFC1918 private-use. Covers the operator's own VPC/LAN: databases, control
  // plane, other tenants' workers. Denying it WOULD put those out of reach of a
  // sandbox; nothing in this unit denies anything.
  "10.0.0.0/8",
  // RFC6598 carrier-grade NAT. Covers provider-internal fabric: managed runtimes
  // commonly address host services and sibling sandboxes out of 100.64/10, so a
  // future enforcer that OMITTED it would leave a lateral path that looks "public"
  // to a naive filter.
  "100.64.0.0/10",
  // Loopback. Covers services bound to 127.0.0.1 inside a sandbox -- the agent
  // CLI's own auth broker, any debug port, any sidecar assumed unreachable.
  // Denying it WOULD make those unreachable from sandbox-originated traffic.
  "127.0.0.0/8",
  // RFC3927 link-local. THE range that carries cloud instance metadata
  // (169.254.169.254 IMDS, 169.254.170.2 ECS task metadata). Credential-theft
  // range; the single most important entry in this table.
  "169.254.0.0/16",
  // RFC1918 private-use (172.16-172.31). Same rationale as 10/8; the /12 boundary
  // is the classic off-by-one (172.32.x is PUBLIC and would have to stay allowed).
  "172.16.0.0/12",
  // RFC6890 IETF protocol assignments. Contains 192.0.0.170/171 (NAT64 discovery)
  // and other host-local protocol addresses; not globally routable, so denying
  // WOULD cost nothing and WOULD close a special-use surface.
  "192.0.0.0/24",
  // TEST-NET-1 (RFC5737). Documentation-only; a real connection attempt here is a
  // misconfiguration or a probe, never legitimate agent traffic.
  "192.0.2.0/24",
  // Deprecated 6to4 relay anycast (RFC7526). Denying this WOULD block a v6-over-v4
  // tunnel that would otherwise carry traffic past a v4-only egress filter.
  // NOTE: this is the one range `mcp-connector-oauth.ts`'s table is missing.
  "192.88.99.0/24",
  // RFC1918 private-use. Home/office LAN range -- relevant for self-hosted and
  // desktop deployments where the sandbox host sits on a real LAN.
  "192.168.0.0/16",
  // RFC2544 benchmarking. Reserved for device testing; used by some appliances as
  // an internal transit range.
  "198.18.0.0/15",
  // TEST-NET-2 (RFC5737). Documentation-only, same rationale as TEST-NET-1.
  "198.51.100.0/24",
  // TEST-NET-3 (RFC5737). Documentation-only, same rationale as TEST-NET-1.
  "203.0.113.0/24",
  // Multicast (224/4) + reserved-for-future-use (240/4), aggregated. Covers
  // local-network multicast discovery (mDNS 224.0.0.251, SSDP 239.255.255.250);
  // denying it WOULD stop that being used to enumerate the host's neighbours.
  "224.0.0.0/3",
]);

/**
 * The exact minimal CIDR cover of `isPrivateIP`'s IPv6 rejection set, derived by
 * a recursive uniformity descent over the leading 16-bit words.
 */
export const INTERNAL_RANGE_DENY_CIDRS_V6: readonly string[] = Object.freeze([
  // Everything with a zero leading word: `::` unspecified, `::1` loopback, and the
  // IPv4-compatible form `::a.b.c.d`. THIS is the entry that covers
  // `::169.254.169.254` -- the address `isPrivateIP` currently fails to parse.
  "::/16",
  // RFC6052 NAT64 well-known prefixes (64:ff9b::/96 and 64:ff9b:1::/48,
  // aggregated). A NAT64 translator turns these into arbitrary IPv4 destinations,
  // so an enforcer that left them open WOULD re-open every IPv4 range listed above.
  "64:ff9b::/47",
  // RFC6666 discard-only prefix. Sink route; no legitimate destination.
  "100::/64",
  // 2001::/32 Teredo. IPv6-over-UDP tunnelling -- another v4 tunnel bypass.
  "2001::/32",
  // 2001:2::/32 BMWG benchmarking.
  "2001:2::/32",
  // 2001:10::/28 ORCHID (deprecated) -- non-routable identifier space.
  "2001:10::/28",
  // 2001:20::/28 ORCHIDv2 -- non-routable identifier space.
  "2001:20::/28",
  // 2001:db8::/32 documentation. Documentation-only, same rationale as TEST-NET.
  "2001:db8::/32",
  // 2002::/16 6to4. The v6 side of the 192.88.99.0/24 tunnel; denying only one end
  // of a tunnel WOULD be denying neither.
  "2002::/16",
  // 3fff::/20 additional documentation space (RFC9637); `isPrivateIP` rejects the
  // wider 3ff0-3fff span, so the exact cover of the predicate is /12.
  "3ff0::/12",
  // fc00::/7 unique local addresses. The IPv6 equivalent of RFC1918 -- covers the
  // operator's own fabric.
  "fc00::/7",
  // fe80::/10 link-local + fec0::/10 deprecated site-local, aggregated. Link-local
  // is the v6 on-link neighbour range; site-local is the deprecated internal range.
  "fe80::/9",
  // ff00::/8 multicast. Same neighbour-enumeration rationale as 224/4.
  "ff00::/8",
]);

/** Both families, in a single frozen list. */
export const INTERNAL_RANGE_DENY_CIDRS: readonly string[] = Object.freeze([
  ...INTERNAL_RANGE_DENY_CIDRS_V4,
  ...INTERNAL_RANGE_DENY_CIDRS_V6,
]);

/** True iff `ip` falls inside ANY of `cidrs`. Pure; family-aware via `ipInCidr`. */
export function isCoveredByDenySet(
  ip: string,
  cidrs: readonly string[] = INTERNAL_RANGE_DENY_CIDRS,
): boolean {
  for (const cidr of cidrs) {
    if (cidr && ipInCidr(ip, cidr)) return true;
  }
  return false;
}

/**
 * The addresses in `addresses` that `isPrivateIP` REJECTS but `cidrs` does NOT
 * cover -- i.e. the holes in `cidrs` relative to the reference predicate, over the
 * given corpus. Empty => `cidrs` is a superset of `isPrivateIP` on that corpus.
 *
 * WHAT THIS CAN AND CANNOT PROVE: agreement over a CORPUS is not a pin. A range
 * can be deleted from the deny set and this still returns empty, if the corpus
 * happens to contain no address in that range. That is precisely why the
 * exact-set assertion and the re-derivation sweep in the test file exist, and why
 * neither is replaceable by this function.
 */
export function findPrivateRangeGaps(
  cidrs: readonly string[],
  addresses: readonly string[],
): readonly string[] {
  return addresses.filter((ip) => isPrivateIP(ip) && !isCoveredByDenySet(ip, cidrs));
}

/** True iff `cidrs` covers every address in `addresses` that `isPrivateIP` rejects. */
export function isSupersetOfIsPrivateIp(
  cidrs: readonly string[],
  addresses: readonly string[],
): boolean {
  return findPrivateRangeGaps(cidrs, addresses).length === 0;
}

/**
 * The standing agreement corpus. Includes every address that has already bitten
 * this programme, in every spelling that reached a real call site.
 */
export const PRIVATE_RANGE_AGREEMENT_CORPUS: readonly string[] = Object.freeze([
  // -- the ones that have already bitten --
  "169.254.169.254", // AWS/GCP/Azure/OpenStack IMDS
  "::ffff:169.254.169.254", // v4-mapped dotted spelling
  "::ffff:a9fe:a9fe", // v4-mapped HEX spelling (URL parsers canonicalize to this)
  "::169.254.169.254", // v4-COMPATIBLE spelling -- isPrivateIP returns FALSE here
  "169.254.170.2", // AWS ECS task metadata
  "fd00:ec2::254", // AWS IMDS over IPv6 (inside fc00::/7)
  // -- one interior address per IPv4 range --
  "0.0.0.1",
  "10.1.2.3",
  "100.64.0.1",
  "100.127.255.254",
  "127.0.0.1",
  "169.254.1.1",
  "172.16.0.1",
  "172.31.255.254",
  "192.0.0.170",
  "192.0.2.1",
  "192.88.99.1",
  "192.168.1.1",
  "198.18.0.1",
  "198.51.100.1",
  "203.0.113.1",
  "224.0.0.251", // mDNS
  "239.255.255.250", // SSDP
  "255.255.255.255",
  // -- one interior address per IPv6 range --
  "::",
  "::1",
  "64:ff9b::1.2.3.4",
  "64:ff9b:1::1",
  "100::1",
  "2001:0:1::1",
  "2001:2:0:1::1",
  "2001:10::1",
  "2001:20::1",
  "2001:db8::1",
  "2002::1",
  "3fff::1",
  "fc00::1",
  "fd12:3456::1",
  "fe80::1",
  "fec0::1",
  "ff02::1",
  // -- PUBLIC controls: must be rejected by NEITHER --
  "8.8.8.8",
  "1.1.1.1",
  "172.32.0.1", // just outside 172.16/12
  "100.128.0.1", // just outside 100.64/10
  "192.88.100.1", // just outside the 6to4 relay /24
  "2606:4700:4700::1111",
  "2001:4860:4860::8888",
]);
