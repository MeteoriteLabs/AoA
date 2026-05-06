// server/src/services/outbound-url-guard.ts
//
// Shared SSRF defense for any outbound HTTP from AoA — used by both the plugin
// HTTP service and the http adapter. Centralized here to avoid divergence
// between the two call sites.
//
// See finding C9 in docs/superpowers/specs/2026-05-05-sprint-1-security-fixes-design.md.

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Only these protocols are allowed for outbound HTTP requests. */
export const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Maximum time (ms) to wait for a DNS lookup before aborting. */
export const DNS_LOOKUP_TIMEOUT_MS = 5_000;

/**
 * Check if an IP address is in a private/reserved range (RFC 1918, loopback,
 * link-local, etc.) that outbound HTTP should never be able to reach.
 *
 * Handles IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1) which Node's
 * dns.lookup may return depending on OS configuration.
 */
export function isPrivateIP(ip: string): boolean {
  const lower = ip.toLowerCase();

  // Unwrap IPv4-mapped IPv6 addresses (::ffff:x.x.x.x) and re-check as IPv4
  const v4MappedMatch = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4MappedMatch && v4MappedMatch[1]) return isPrivateIP(v4MappedMatch[1]);

  // IPv4 patterns
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("172.")) {
    const second = parseInt(ip.split(".")[1]!, 10);
    if (second >= 16 && second <= 31) return true;
  }
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("127.")) return true;                   // loopback
  if (ip.startsWith("169.254.")) return true;               // link-local
  if (ip === "0.0.0.0") return true;

  // IPv6 patterns
  if (lower === "::1") return true;                          // loopback
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  if (lower.startsWith("fe80")) return true;                 // link-local
  if (lower === "::") return true;

  return false;
}

/**
 * Request-routing metadata returned by `validateAndResolveFetchUrl`. Callers
 * that want full DNS-rebind defense can use these fields to build a request
 * that connects to `resolvedAddress` directly (via `https.request` / undici
 * dispatcher) while preserving the original `hostHeader` and `tlsServername`
 * so the remote endpoint matches its TLS cert and Host-header routing.
 */
export interface ValidatedFetchTarget {
  parsedUrl: URL;
  resolvedAddress: string;
  hostHeader: string;
  tlsServername?: string;
  useTls: boolean;
}

/**
 * Validate a URL for outbound fetch: protocol whitelist + private IP blocking
 * + DNS-resolution timeout. Returns request-routing metadata that can be used
 * either with fetch (validation-only — DNS-rebind window remains) OR with
 * `https.request` / undici dispatcher to pin the resolved IP and close the
 * DNS-rebind window entirely.
 *
 * For the static-misconfig SSRF threat (e.g. `http://169.254.169.254/...`),
 * fetch + this validation is sufficient. For DNS-rebind defense, the caller
 * must additionally pin the resolved IP — see `buildPinnedRequestOptions`
 * in `plugin-host-services.ts` for an example.
 */
export async function validateAndResolveFetchUrl(urlString: string): Promise<ValidatedFetchTarget> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(`Invalid URL: ${urlString}`);
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(
      `Disallowed protocol "${parsed.protocol}" — only http: and https: are permitted`,
    );
  }

  // Resolve the hostname to an IP and check for private ranges.
  // We pin the resolved IP into the URL to eliminate the TOCTOU window
  // between DNS resolution here and the second resolution fetch() would do.
  const originalHostname = parsed.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  const hostHeader = parsed.host; // includes port if non-default

  // Race the DNS lookup against a timeout to prevent indefinite hangs
  // when DNS is misconfigured or unresponsive.
  const dnsPromise = dnsLookup(originalHostname, { all: true });
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`DNS lookup timed out after ${DNS_LOOKUP_TIMEOUT_MS}ms for ${originalHostname}`)),
      DNS_LOOKUP_TIMEOUT_MS,
    );
  });

  try {
    const results = await Promise.race([dnsPromise, timeoutPromise]);
    if (results.length === 0) {
      throw new Error(`DNS resolution returned no results for ${originalHostname}`);
    }

    // Filter to only non-private IPs instead of rejecting the entire request
    // when some IPs are private. This handles multi-homed hosts that resolve
    // to both private and public addresses.
    const safeResults = results.filter((entry) => !isPrivateIP(entry.address));
    if (safeResults.length === 0) {
      throw new Error(
        `All resolved IPs for ${originalHostname} are in private/reserved ranges`,
      );
    }

    const resolved = safeResults[0]!;
    return {
      parsedUrl: parsed,
      resolvedAddress: resolved.address,
      hostHeader,
      tlsServername: parsed.protocol === "https:" && isIP(originalHostname) === 0
        ? originalHostname
        : undefined,
      useTls: parsed.protocol === "https:",
    };
  } catch (err) {
    // Re-throw our own errors; wrap DNS failures
    if (err instanceof Error && (
      err.message.startsWith("All resolved IPs") ||
      err.message.startsWith("DNS resolution returned") ||
      err.message.startsWith("DNS lookup timed out")
    )) throw err;
    throw new Error(`DNS resolution failed for ${originalHostname}: ${(err as Error).message}`);
  }
}
