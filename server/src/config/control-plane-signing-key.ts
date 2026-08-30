// server/src/config/control-plane-signing-key.ts
//
// DEP-012 Slice 4+5 (P2) — load the control-plane ed25519 PRIVATE key that MINTS the
// owned-labels capability (services/owned-labels-mint.ts), or return undefined (inert).
// Extracted from the composition root so the fail-closed behaviour is unit-testable
// (index.ts wires it and owns the single `process.env.AOA_CONTROL_PLANE_SIGNING_KEY_FILE`
// literal — documented for brand-check step 9).
//
// ★ [Mint-2] Mirrors the adapter-manager bin's try/catch → refuse STRUCTURE
// (packages/adapter-manager/src/bin/adapter-manager.ts): the read + parse + ed25519 assert
// are ALL wrapped, so an encrypted PEM ("BEGIN ENCRYPTED PRIVATE KEY", which passes a naive
// "PRIVATE KEY" string-guard then throws with no passphrase), a DER key, or an RSA key
// THROWS inside the try rather than crashing the composition root uncaught.
//
// Fail-closed ASYMMETRICALLY (the [Mint-2] scope):
//   - env unset/empty ⇒ undefined (inert — no keypair configured, pre-DEP-011 behaviour);
//   - env set but unparseable/non-ed25519 AND distributed execution ON ⇒ a LOUD FATAL throw
//     (never a silent fall to undefined = the dead path: the adapter-manager gates every
//     create with the matching PUBLIC key while the control plane mints nothing, so every
//     distributed create fails, indistinguishably from an ownership denial);
//   - env set but bad AND distributed execution OFF ⇒ undefined (a mint-key typo is not
//     worth crashing a non-distributed control plane at boot — disproportionate).

import { createPrivateKey, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * @param keyFile the value of AOA_CONTROL_PLANE_SIGNING_KEY_FILE (a mounted PEM path).
 * @param distributedExecutionEnabled whether the distributed execution path is on — scopes
 *   the "present-but-bad ⇒ loud fatal" behaviour (off ⇒ a bad key stays inert, no crash).
 * @param readKeyFileBytes injectable fs seam (default readFileSync) — the REAL parser runs
 *   on the injected bytes, so tests exercise the unparseable / non-ed25519 refuse paths.
 */
export function loadControlPlaneSigningKey(
  keyFile: string | undefined,
  distributedExecutionEnabled: boolean,
  readKeyFileBytes: (path: string) => Buffer = (path) => readFileSync(path),
): KeyObject | undefined {
  const keyPath = keyFile?.trim();
  if (!keyPath) return undefined;
  try {
    // createPrivateKey MUST sit inside this try: an encrypted PEM or a DER/RSA key throws
    // HERE, and that throw must be a scoped refusal — a catch scoped only to the read, or a
    // naive "PRIVATE KEY" string-guard, would fail open (an encrypted PEM would pass the
    // string-guard then throw uncaught).
    const key = createPrivateKey(readKeyFileBytes(keyPath));
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error(`expected an ed25519 key, got ${String(key.asymmetricKeyType)}`);
    }
    return key;
  } catch (err) {
    if (distributedExecutionEnabled) {
      throw new Error(
        `AOA_CONTROL_PLANE_SIGNING_KEY_FILE is set but could not be loaded as an ed25519 PRIVATE key ` +
          `(${(err as Error).message}). Distributed execution is enabled, so refusing to boot with an ` +
          `unwired mint: the adapter-manager gates every create with the matching PUBLIC key while the ` +
          `control plane would mint nothing, silently killing the entire distributed create path.`,
      );
    }
    // Distributed execution OFF: a mint-key typo is not worth crashing the control plane.
    return undefined;
  }
}
