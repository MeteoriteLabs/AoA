// server/src/services/execution-secret-brokers.ts
//
// DAT-008 slice 3 — the REAL value store behind the DAT-004 broker.
//
// `failClosedSecretBrokers` is the default, and its own comment says it stands
// "until DAT-005 wires the real chokepoints". DAT-005 wired the proxy but not the
// stores, so every resolve still throws. This binds the two arms DAT-008 needs and
// deliberately leaves the third fail-closed.
//
//   provider_key   -> the Company's `provider:<id>` secret, resolved by NAME
//   company_secret -> the agent's own secret, resolved by ID at its pinned version
//   connector_oauth -> STILL FAIL-CLOSED (see below)
//
// `connector_oauth` belongs to the `fence_proxy` credential class, whose value is
// rendered into request headers inside the egress proxy and must never reach a
// sandbox or a worker. Wiring it here would make it reachable from the
// sandbox-local redemption route, which is exactly the coercion DAT-004's own review
// had to fix once. It stays throwing until its own path is built.
//
// The broker runs AFTER `resolveExecutionSecret` has authorized the resolve behind an
// active fence, so this module performs no authorization of its own — by design. It
// is a value lookup, and treating it as a second gate would split the authority.

import type { Db } from "@armyofagents/db";
import { secretService, type SecretConsumerContext } from "./secrets.js";
import type { SecretBrokerSet } from "./secret-broker.js";

/** Parse the stored selector back into what `resolveSecretValue` takes. Anything that
 * is not a positive integer resolves as `latest`, which is also the canonical default
 * for an unpinned ref — a malformed selector must not become version 0 or NaN. */
export function parseSecretVersion(refVersion: string | null): number | "latest" {
  if (refVersion === null || refVersion === "latest") return "latest";
  const parsed = Number(refVersion);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : "latest";
}

/**
 * The consumer context for an execution-secret resolve.
 *
 * `consumerType: "system"` mirrors `resolveCompanyProviderKeys`' own narrowing and is
 * load-bearing rather than cosmetic: `shouldEnforceSecretBinding` would otherwise
 * demand a `company_secret_bindings` row, and `provider-key.ts` deliberately writes
 * none for a company-level default. Without the narrowing every provider-key resolve
 * would fail on a binding that by design never exists.
 */
function consumerContextFor(handleId: string): SecretConsumerContext {
  return {
    consumerType: "system",
    consumerId: handleId,
    configPath: null,
    actorType: "system",
  };
}

export function createExecutionSecretBrokers(db: Db): SecretBrokerSet {
  const secrets = secretService(db);
  return {
    async resolveConnectorOAuth() {
      // Intentionally unreachable from the sandbox-local path — see the header.
      throw new Error("connector_oauth broker not wired (fence_proxy class, DAT-008 non-goal)");
    },
    async resolveProviderOrCompanySecret(input) {
      const context = consumerContextFor(input.handleId);
      if (input.refKind === "provider_key") {
        // A `provider:<id>` NAME, not an id — the same name `resolveProviderKeyTarget`
        // reports and the mint stored.
        return secrets.resolveByName(input.companyId, input.refId, context);
      }
      return secrets.resolveSecretValue(
        input.companyId,
        input.refId,
        parseSecretVersion(input.refVersion),
        context,
      );
    },
  };
}
