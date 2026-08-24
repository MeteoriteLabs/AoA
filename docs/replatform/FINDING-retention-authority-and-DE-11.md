# FINDING — DE-11's controls do not exist, and artifact retention is worker-supplied

**Raised by:** Lane A, during terrain for the retention-enforcement follow-up named in
[`DAT-009-slice-2-result.md`](./epics/E5-workspaces-secrets/tickets/DAT-009-slice-2-result.md) §7.2.
**Status:** FINDING. No code changed. **Every claim below was re-verified by hand.**

**Not an incident.** Nothing enforces retention today, and no production path uploads
`browser_cookie_state` / `browser_storage_state` (BRW-003 is unbuilt). There is no live
exploit. What is live and wrong *now* is the **documentation**, and what would be wrong
*immediately on building enforcement* is the **authority**.

---

## ★ 1. The security-control register asserts four controls, none of which exist

`docs/architecture/distributed-execution-threat-controls.json` records **DE-11 — "Browser
cookie/trace leakage", severity `High`** — with:

| Field | Asserted | Reality |
|---|---|---|
| `trustedSide` | "a job-scoped sensitive-artifact store **with a TTL**" | No TTL exists. `ARTIFACT_RETENTION_CLASSES` (`policy.ts:200-203`) is four **names with no durations** — verified by exhaustive grep; every duration-bearing `retention` in the repo belongs to an unrelated subsystem (plugin logs, backups, memory settings) |
| `confidentiality` | "sensitive browser artifacts are **encrypted** and TTL-bounded" | **No encryption.** `server/src/storage/s3-provider.ts:157-165` builds `PutObjectCommand` with Bucket / Key / Body / ContentType / ContentLength and **no `ServerSideEncryption`** |
| `revocation` | "TTL expiry and job completion **purge** sensitive artifacts" | Nothing purges. `deleteObject` has two call sites in the whole repo, both task attachments; no S3 lifecycle rule exists; committed artifacts are never collected |
| `audit` | "sensitive-artifact access and **retention are audited**" | Nothing reads the retention column at all, so there is nothing to audit |

Its own `verification` field reads **"browser retention/authorization"** — pointing at the
mechanism that does not exist.

**A High-severity threat is recorded as controlled by four mechanisms, none of which are
built.** That is worse than an uncontrolled threat, because a reader of the register stops
looking.

## 2. The same claim is repeated in five more authoritative documents

- `distributed-execution-lifecycles.md:101,335,406` — "job-scoped sensitive artifacts with
  explicit retention", "written with explicit retention under the active fence".
- `program-design.md:133`; **`:410` — DAT-002's Acceptance clause** "sensitive browser
  artifacts have explicit retention". **DAT-002 is LANDED**, so that shipped acceptance is
  satisfied only if "explicit" means "a required string field".
- **`program-design.md:845` — BRW-001's Acceptance** "bounded TTL and artifact retention are
  mandatory", recorded satisfied in `BRW-001-result.md:43` **by the unit test of a map that
  has zero production callers.** An acceptance clause closed by a function nothing calls.
- `agent-execution-guide.md:72` — "restricted artifact … retention are explicit".

Only `distributed-execution-authority.md:27` is honest: *"Browser state and service
checkpoints have sensitivity and retention **metadata**"* — which is exactly all it is.

**No ticket in the 94-ticket programme owns deleting a committed artifact.** BRW-006 is given
a UI that displays "retention status" — a read surface over a column nothing enforces.

## ★★ 3. The authority is INVERTED, and this is the part that changes the plan

`server/src/services/browser-artifact-retention.ts:5-14` states the rule and its reason:

> retention is *"control-plane-owned, and never caller- or worker-supplied"* … *"A caller or
> worker choosing the retention of a `browser_cookie_state` or `browser_storage_state`
> artifact is a privilege the threat model must not grant — those artifacts carry live
> session credentials."*

**`server/src/services/artifact-commit.ts:144-145` does exactly what that forbids:**

```ts
sensitivity: manifest.sensitivity,
retention:   manifest.retention,     // ← straight from the WORKER'S manifest
```

The module that exists to deny this privilege has **zero production callers**; the commit
path takes the worker's word.

**Consequence for sequencing — this is the finding's real payload.** Building enforcement on
top of a worker-supplied value would **enforce the worker's choice**: a compromised or buggy
worker declares its `browser_cookie_state` as `audit` rather than `ephemeral`, and a
correctly-built TTL sweeper then dutifully preserves a live session credential for the long
class instead of deleting it.

> **Enforcement on an inverted authority is worse than no enforcement**, because it converts
> a dormant misclassification into an actively honoured one.

So the retention follow-up must be resequenced: **fix the authority first, enforce second.**

## 4. `sensitivity` is decorative in v1, and that is fine

`artifactSensitivitySchema = z.literal("restricted")` (`artifacts.ts:279-283`) is
single-valued, so the field carries no discriminating information and cannot be downgraded by
relabeling. Nothing branches on it. Worth recording so nobody builds a policy on it believing
it means something today.

Also noted: the class `audit` is in the vocabulary and **no kind maps to it**.

## 5. Recommended sequence

1. **Correct the documents** (§1, §2). A false control claim is the cheapest thing here to fix
   and the most dangerous to leave. DE-11 should state the controls as *planned*, not present.
2. **Fix the authority** (§3): derive `retention` (and `sensitivity`) control-plane-side at
   commit from the frozen `kind`, using the map that already exists and is already tested —
   ignoring whatever the manifest claims. Small, and it gives the zero-caller module its
   caller.
3. **Then** build enforcement — durations per class, and a deletion path with the
   tenant-enumeration question from `DAT-009-slice-2-result.md` §6 answered.

Steps 1 and 2 are small and independent. Step 3 is the ticket that was originally named, and
it should not start before step 2.

## 6. What is NOT claimed here

No live exploit. Nothing uploads these artifact kinds yet, and no enforcement exists to be
subverted. The severity is in the **register being wrong** and in the **ordering trap** that
would otherwise be walked into.
