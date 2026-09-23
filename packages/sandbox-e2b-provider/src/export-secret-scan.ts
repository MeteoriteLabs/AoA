// packages/sandbox-e2b-provider/src/export-secret-scan.ts
//
// CLI-017-B — SD-5's LITERAL-VALUE export scanner (ruling F7, `E7-D11` §3).
//
// The probe measured the hazard rather than arguing it: run `35833717162`, arm `S-P7`, verdict
// `nonce-exported-in-file-bytes`, decision-table row **R4** fired on `noncePresent=true`. An
// environment value CAN land in a file under `R` and be read back out of the sandbox, and without
// a provider-side refusal a tenant secret written into `R` reaches a durable store — which is
// what Decision #104's "must not hit a durable store" forbids. §3 rules SD-5 IN and REQUIRED
// before `M1b`'s campaign.
//
// ★★★ WHAT THIS DOES NOT DO, SAID HERE SO NOBODY READS IT AS CLOSING EXFILTRATION.
// This is a LITERAL-VALUE refusal. An agent with shell access can `base64`- or `hex`-encode
// `$ANTHROPIC_API_KEY`, reverse it, or split it across several files; the per-file policy
// (`E5-D07`) then finds no exported file containing the literal value and EVERY PUT PROCEEDS. So
// it closes the case the probe actually measured — a VERBATIM env value written out, the accident
// and naive-agent case, which nothing at all stops today — and it is NOT a secure boundary
// against a hostile agent. The residual is filed as `E7-F038` (MEDIUM, open, `unowned`), it is
// NOT closed by this slice shipping, and acceptance row 8 carries the encoded and split cases as
// CHARACTERISATION tests asserting they pass through.
//
// ★★★ AND IT IS NOT A LOG REDACTOR. `@armyofagents/shared`'s `shouldRedactSecretValue` is the
// repo's classifier for LOGS, and it is deliberately not reused here — verified at source, not
// assumed: `packages/shared/package.json` publishes `"exports": {".": "./src/index.ts"}`, i.e.
// TypeScript SOURCE, while this package compiles to `dist` and is loaded at runtime by the
// adapter-manager through a bare dynamic import. Depending on it would put an unbuildable
// specifier in this package's emitted JavaScript. The rule below is therefore this package's
// own, stated in full rather than claimed to mirror anything.

/**
 * The classification rule, in one sentence: **a run env entry is secret-classified when its KEY
 * looks sensitive or its VALUE looks like a credential, AND the value is long enough that a
 * literal match cannot be a coincidence.**
 *
 * ★ THE LENGTH FLOOR IS THE ANTI-COLLISION ARM, AND IT IS LOAD-BEARING. Without it a run whose
 * env contained `LANG=C`, `CI=1`, `TERM=xterm` or `AWS_REGION=us-east-1` would refuse EVERY
 * export, because those two-to-eight-character strings appear inside ordinary prose, inside
 * field names, and inside longer words and digit runs. A scanner that refuses everything is
 * indistinguishable from a broken export path and would be turned off. So short values are not
 * scanned — and that is a STATED LIMIT, not an oversight: a genuinely short credential written
 * verbatim is not caught. Every credential this ruling is about (`sk-ant-…`, a run JWT, a
 * presigned URL) is far above the floor, and `E7-F038` already records that SD-5 is a partial
 * control rather than a boundary.
 */
export const MIN_SCANNED_SECRET_LENGTH = 12;

/**
 * Key names whose values are treated as credentials whatever they look like.
 *
 * Widened on purpose: over-classifying an env value costs a REFUSED export, which is per-file,
 * best-effort-outward (`E5-D07`) and visible; under-classifying one costs a credential at rest in
 * durable object storage. The two are not symmetric, so this errs wide.
 *
 * ★★★ THE SHORT FRAGMENTS ARE TOKEN-ANCHORED, AND THAT IS NOT A STYLE CHOICE — IT IS A BUG THIS
 * SLICE'S OWN TESTS CAUGHT. A first draft matched `pat` as a bare substring, which classifies
 * **`PATH`**. Every sandbox has a `PATH`, its value is comfortably over the length floor, and a
 * deliverable that prints a directory listing or a shell line contains it — so the scanner would
 * have refused a large share of perfectly clean exports while looking like a working control.
 *
 * ★ SWEPT AS A CLASS, NOT AS THE ONE INSTANCE. The class is *"a secret-key fragment short enough
 * to appear inside an unrelated env name"*. Enumerated over the fragment list: `pat` (PATH,
 * COMPATIBILITY), `dsn` and `jwt` are the three at or below three characters; everything else
 * (`key`, `token`, `auth`, `secret`, `cookie`, `bearer`, `signing`, `webhook`, `private`,
 * `session`, `credential`, `connection`, `password`, `passwd`) is four or more and has no common
 * env-name host. So all three short ones are anchored to `_`/start/end token boundaries, and the
 * longer ones stay substring matches on purpose: over-classifying there costs a refused export,
 * which is per-file and visible, while under-classifying costs a credential at rest.
 */
export const SECRET_ENV_KEY_PATTERN =
  /(key|token|secret|password|passwd|auth|cookie|credential|bearer|signing|webhook|private|session|(^|_)(pat|dsn|jwt)(_|$)|connection)/i;

/**
 * Value shapes that are credentials regardless of the key name — the case that bites when a
 * secret is bound to an innocuously named variable (`DATABASE_URL`, `STRIPE_LIVE`, `ENDPOINT`).
 */
export const SECRET_ENV_VALUE_PATTERNS: readonly RegExp[] = Object.freeze([
  // Connection strings / DSNs carrying inline credentials.
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqp|kafka|nats|mssql|sqlserver):\/\/[^\s<>'")]+/i,
  // Anthropic / OpenAI-style provider keys.
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{12,}\b/,
  // GitHub tokens.
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  // AWS access key ids.
  /\bAKIA[0-9A-Z]{16}\b/,
  // Generic `<prefix>_<long-random>` vendor token shape.
  /\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9]{20,}\b/,
  // JWTs.
  /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  // PEM private-key blocks.
  /-----BEGIN[A-Z ]*PRIVATE KEY-----/,
  // Presigned-URL signatures (an upload grant's url is a bearer capability).
  /[?&]X-Amz-Signature=[A-Fa-f0-9]{16,}/,
]);

/** True when this env entry's VALUE is one the export scan must refuse on. */
export function isSecretClassified(key: string, value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.length < MIN_SCANNED_SECRET_LENGTH) return false;
  if (SECRET_ENV_KEY_PATTERN.test(key)) return true;
  return SECRET_ENV_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Reduce a run's `env` to the DISTINCT secret-classified VALUES the export scan compares against.
 *
 * ★ VALUES ONLY — the key names never travel with them. Row 7 requires the secret set to be
 * absent from every log line and every thrown message; carrying the names alongside would make an
 * accidental dump name the tenant's variables even if it withheld their values.
 */
export function classifyRunSecrets(env: Readonly<Record<string, string | undefined>> | undefined): readonly string[] {
  if (!env) return [];
  const values = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    if (isSecretClassified(key, value)) values.add(value as string);
  }
  // Longest first: a shorter secret that is a substring of a longer one is still found, and the
  // order makes the scan's first match the most specific one. (Nothing downstream reads the
  // match, but a deterministic order keeps the scan's cost predictable.)
  return Object.freeze([...values].sort((a, b) => b.length - a.length));
}

/** What the provider hands its scanner. Defined HERE, by the slice that supplies the scanner —
 * `E7-F040` records that the signature is `CLI-017-B`'s to settle. */
export interface ExportScanInput {
  /** The exact bytes that are about to leave, already verified against the grant's digest. */
  readonly bytes: Uint8Array;
  /** The sandbox the bytes came from. Present for attribution; the scan is keyed on `secrets`. */
  readonly sandboxId: string;
  /** THIS sandbox's secret-classified env values, resolved by the provider from its own
   * sandbox-scoped registry. Never another sandbox's, and never global (founder ruling F10). */
  readonly secrets: readonly string[];
  /**
   * `E7-F040`, CLOSED HERE RATHER THAN DEFERRED. `CLI-012`'s round-5 sweep fixed
   * `E2bTransport.readFile`, `listDir` and `statEntry` for the class *"a bounded operation that
   * returns at its deadline without aborting the underlying work"*, and recorded this seam as the
   * one site that carried no signal — leaving the decision to the ticket that supplies the
   * implementation. The decision is: TAKE THE SIGNAL. It costs one field, it removes the class
   * from this surface permanently, and it means a future scanner that does remote or streaming
   * work inherits cancellation instead of re-filing the finding.
   */
  readonly signal: AbortSignal;
}

/** The seam `E2bSandboxProvider` injects. A clean resolve is the ONLY path that exports. */
export type ExportBytesScanner = (input: ExportScanInput) => void | Promise<void>;

/**
 * The real SD-5 scanner: refuse when the bytes contain any of this run's own secret-classified
 * env values, verbatim.
 *
 * ★ IT THROWS A BARE ERROR WITH NO DETAIL. `exportArtifact` converts any throw into
 * `SandboxExportScannerRefusedError`, whose message is a fixed string, and this scanner's own
 * message never rides out — it has seen the file's bytes. Nothing here names the matched value,
 * its length, its env key, the path or the byte offset.
 *
 * ★ IT DECODES ONCE, LOSSILY, AND THAT IS DELIBERATE. `TextDecoder` with the default lossy mode
 * maps invalid sequences to U+FFFD rather than throwing, so a binary or mis-encoded artifact is
 * still SCANNED instead of being waved through as "not text". A secret is ASCII in every form
 * this ruling is about, and ASCII survives lossy UTF-8 decoding intact.
 */
export function createRunSecretExportScanner(): ExportBytesScanner {
  return (input: ExportScanInput): void => {
    if (input.secrets.length === 0) return;
    const text = new TextDecoder("utf-8").decode(input.bytes);
    for (const secret of input.secrets) {
      if (text.includes(secret)) {
        // No detail. See the note above.
        throw new Error("export secret scan: refused");
      }
    }
  };
}
