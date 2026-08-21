# DSK-003 — result

**Date:** 2026-08-21
**Branch:** `docs/replatform-program` (PR #323)
**Start SHA:** `40f512c8f` (the DSK-003 design, committed before any code)
**Tip:** `1bba6c86b`
**Covers:** D1–D10; invariants I1, I2, I5, I6, I7, I8, I9, I10, I11

**This is a partial closure, and §6 says exactly which clause is not closed and why.**
Clauses (1), (2) and (5) are met; clause (3) was already met by WRK-006/007; clause (4)'s
authorization, command surface and host-discovery are built but the **effect layer is
not wired**.

---

## 1. What shipped

| Commit | Increment | Mutants |
|---|---|---|
| `5155d2a60` | one owner-only custody rule; the untested half now tested | 8/8 |
| `10ef8dd76` | the local control token (I1, I2) | 9/9 |
| `358cc1764` | default-deny command authorization (I1) | 8/8 |
| `cf0a1b708` | uninstall plan — explicit identity policy (I6, I7) | 8/8 |
| `acd9ff97a` | embedded-secret scan + CI self-test (I10, I11) | 9/9 |
| `951f0a113` | per-user unprivileged autostart + the H.D1 supersession (I8) | 12/12 |
| `7ea62626c` | fail-closed installer admission (I9) | 11/11 |
| `401b1dc68` | host state record + the stale-pid defence | 10/10 |
| `73f0a563a` | `GET /instance` — the live half of that defence | 5/5 |
| `770224daf` | the control effect layer + the revoke-bypass guard | 8/8 |
| `ab67a6bfb` | the composition root — the record's lifecycle | 7/7 |
| `cd76988e3` | invocation routing — a control command never boots | 5/5 |
| `9f5e10e9f` | the macOS agent was discarding its own output | 8/8 |
| `383548a22` | control-file locations, derived from the vault | 4/4 |
| `1bba6c86b` | the host routes control commands | 5/5 |

**117 mutants, 117 killed.** Five of those only after the mutant exposed something wrong in
my own work rather than in the code under test (§4).

---

## 2. The finding that changed the ticket's shape

**Signing was not the blocker, and the handoff's operator prerequisites were overstated.**
I opened this ticket saying code-signing certificates and macOS hardware gated it. Reading
the program says otherwise:

- **REL-004 owns it** — "Pin, scan, sign, and attest control-plane, worker, sandbox, and
  every enabled desktop installer/updater artifact."
- **DEP-001 already ships the pattern** — `image-admission.mjs`, a pure fail-closed
  `node:crypto` verifier on a **TEST** cosign key, whose own acceptance text says
  "REL-004 later replaces test roots with release roots."

So DSK-003 builds the artifact and its *verification*, on a test root, and reaches
CI-green with no certificate. Certificates, notarization and macOS hardware gate
**beta-gate evidence**, not this ticket's code. That distinction is worth keeping: it is
the difference between a blocked ticket and a ticket with an evidence tail.

---

## 3. The central security decision

`health-server.ts` binds loopback-only and has **no authentication of any kind** — correct
for `GET /healthz` and payload-free counters, which is read-only liveness exposing no
tenant data.

Clause (4) also asks for `drain` and `revoke`. Serving those from the same surface would
change the category: unauthenticated **mutating** control reachable by every local
process. On a shared desktop, any local user — or anything the user runs — could revoke
the worker's identity or drain its work. **Loopback is a network boundary, not an
authorization boundary.**

So the surface splits by mutation (D1), with the OS as the authority: the control token is
a file only the installing user can read, which reduces "may this caller control the host"
to a question the operating system already answers better than this process could.

Two consequences worth naming:

- **Authorization is default-deny.** `requiresControlToken` is "not in the read-only
  allowlist", never "in the mutating list". A `pause` or `rotate` added later by someone
  who never opens the file is gated automatically; a maintained list of mutating commands
  fails open exactly once, silently, in the direction that matters.
- **`revoke` is named for what it does.** A desktop cannot revoke its own server-side
  target — that authority is the control plane's. It destroys the LOCAL identity and stops
  work. A `revoke` that silently did half the job would read as a security control it is
  not.

---

## 4. Where mutation earned its keep

117/117 is the boring number. These are the ones that mattered:

**Three surviving mutants were dead code, not missing tests**, and each was removed or
documented rather than papered over with a contrived test:

- a `& 0o777` pre-mask in the custody check that **cannot** affect any result, because
  `0o077` already selects the low six bits — carried by both prior copies, and my own test
  comment asserted it was load-bearing. It was not; the claim was wrong and is corrected.
- a redundant `unreadable` arm in the token verifier — a file that cannot be stat'ed also
  cannot be read, and both ended at `no_token_file`.
- an equivalent policy spelling in the uninstall plan, where the preceding validation has
  already narrowed the value to two options.

**One surviving mutant exposed a real ordering bug**: the control token was being READ
before its file permissions were validated. Reordered to custody-first, and the ordering
is source-pinned because it is a principle, not an observable behaviour.

**Two exposed gaps in my own tests**: a flag guard never exercised because the only flag
case was `--token=` (consumed before the guard), and a documented allowlist rule — one bad
entry rejects the whole list — that nothing tested.

**Two mutants were simply wrong**, not coverage gaps. One appended `arguments[3]` at a
3-arg call site — `undefined`, dropped by `JSON.stringify`, so nothing leaked. The other
reordered whole blocks and was killed by a SYNTAX ERROR rather than by the ordering test
it was aimed at; the harness reported "killed, but these expected tests did not fail",
which is the only reason it was caught. **A kill for the wrong reason proves nothing**,
and the mutant was rewritten as a single well-formed insertion.

### The guarded action with a second, unguarded door

`--reset-identity` requires `--i-understand-this-is-permanent`, because on the same target
the reset IS a permanent lockout — the server denies the re-minted workerId and
`findWorkerForBinding` has no status predicate, so the stale row matches forever with no
reset route. **`revoke` destroys the same identity.** Shipping it without that
acknowledgement would have left the guard in place and simply off the path anyone takes.
The flag is duplicated (the daemon may not depend on the keystore package) and therefore
pinned by test across the package boundary — both the constant and the line that checks
it — because a duplicated guard that drifts is two guards.

### The guard that was born dead, again

The autostart control-character check first shipped as a regex character class containing
**raw control bytes** where the escape sequences were meant. It compiled, read correctly,
and matched nothing. DSK-001 hit the identical failure with a backspace byte in place of a
word boundary. It is now a `charCodeAt` scan — no escaping surface to get wrong — with the
reason in the source so nobody "simplifies" it back.

### Reusing a helper by name without reading it

`installer-admission.mjs` first imported `normalizeAllowlist` from the image verifier. It
**requires** a `sourceRevision` on every entry and returns only
`{image, digest, sourceRevision}` — so installer entries' `version` and `platform` were
rejected outright and, had they passed, silently dropped. An image-shaped helper wearing a
generic name. Nine tests failed at once, which is the cheap way to find that out.
`verifyDetachedSignature`, `normalizeTrustRoot` and `DIGEST_RE` **are** generic and are
still reused.

---

## 5. Corrections and governance

**Each format has a different injection vector, and conflating them hides one.** My first
autostart test asserted the XML vector against systemd and failed — for the wrong reason,
which exposed the right one. A unit file is INI-like, so `<RunLevel>` in a path there is
inert text and `xmlEscape` would be actively **wrong**, since systemd reads the raw path.
The systemd vector is a NEWLINE: it closes `ExecStart=` and opens a fresh directive, and
`User=root` on that line is exactly the elevation the module prevents.

**Three of my own assumptions were wrong, and running found them where reasoning did
not.** The bootstrap requires an enrolment code in EVERY key-store mode, not only
`os_keychain`. Config **rejects** health port 0 although the health server itself accepts
it — two different validations of the same value. And `bin/worker-daemon.ts` is CRLF, so
multi-line edit anchors fail silently against LF search strings. The port test is better
for the second: it now uses two real ports, so the configured and bound values are
genuinely distinguishable rather than both being zero.

**H.D1 is superseded, not contradicted (D9).** `distribution.md` locks "Docker + NPM only.
No desktop installer in Phase H." It is scoped to Phase H by its own heading;
`decisions.md` carries no locked desktop-installer decision (checked, not assumed); and
`program-design.md` — which `accepted-caveats.md` names authoritative — schedules DSK-003
and counts installed-desktop targets in foundation completion. `distribution.md` now
records the supersession, what has *not* changed (Docker + npm remain the control-plane
path; desktop stays off until its own beta gate; signing is REL-004's), and why. Leaving
two committed documents disagreeing is how a future reader concludes the installer was
built by mistake.

**The secret scanner immediately proved its own design rationale.** Pointed at
`packages/worker-daemon/src` it correctly reported three findings — all deliberate
redaction-test fixtures. That is precisely why D7 says scan the packaged artifact and not
source, and why the CI step runs the self-test only.

---

## 5a. A defect this ticket shipped, found by asking why `logs` had nothing to read

The LaunchAgent plist carried `Label`, `ProgramArguments`, `RunAtLoad`, `KeepAlive` and
`ProcessType` — and no `StandardOutPath`. Modern launchd routes an agent's stdout nowhere
by default, so **every line the macOS host wrote went to `/dev/null`**. A background host
you cannot get logs out of is one you cannot diagnose, and it is the reason `readLogTail`
appeared to have no target: nothing was ever written.

The fix is per-platform, and for one platform it is deliberately nothing:

| | |
|---|---|
| **darwin** | launchd redirects natively — two plist keys, no host cooperation. Both keys, because launchd treats them independently and capturing stdout while discarding stderr loses exactly the lines worth reading. |
| **linux** | systemd **already** captures stdout to the journal. A file here would be worse, not more consistent: it bypasses journald's rotation, retention and access control and splits one host's output across two places. `journalctl --user` is the answer. |
| **win32** | Task Scheduler has **no** native redirection. Emitting a path nothing honours would read as "logs are captured" while output still went nowhere — the exact dishonesty this fix corrects. **Recorded residual**, pending the host opening its own file. |

The keys are emitted only when a home directory is known: half a path is worse than none,
since launchd would create a file wherever it resolved a relative string.

## 6. What is NOT done

- **Clause (4) is REACHABLE.** A control invocation now routes, authorizes, resolves the
  running host, acts, and returns — without bootstrapping. `revoke` destroys the same
  pair in the same order as `--reset-identity`, and for the same recorded reason.

  **What is still injected rather than implemented:** the host takes `signal`,
  `resolveTarget`, `readStatus` and `readLogTail` as dependencies and no production
  wiring supplies them yet. Each is thin and unambiguous except `readLogTail` on Windows,
  which has no target at all (§5a). So the surface is complete and testable end-to-end
  through injection, and one composition step short of usable from a terminal.

- **No installer is produced.** Lane C ships the autostart manifests and the
  least-privilege assertions; it does not ship a `.pkg`, `.msi` or staging root. The
  admission verifier and the secret scan are therefore *ready for* an artifact rather than
  applied to one — `check-embedded-secrets.mjs <dir>` is the entry point waiting for it.
- **Repair and diagnostics** from the outcome sentence are not built.
- **Operator evidence remains open**: production code-signing certificates (REL-004),
  Apple notarization credentials, and macOS hardware for the advertised-OS matrix. None of
  these blocks the code; all of them block the desktop beta gate.

---

## 7. Behaviour changes worth a release note

1. **`MountedSecretKeyStore` and `MountedSecretKekStore` now refuse an unreadable file**
   rather than letting a raw `fs` error escape a security check. Same outcome for the
   caller, clearer failure.
2. **The keystore package exports `install/autostart`** and the daemon exports the control
   surface and custody helpers. Additive; no existing export changed.
3. **`GET /instance` is a new loopback route**, served only when the host is started with
   an instance nonce. Absent one it 404s and the surface is byte-identical to before.
4. **`distribution.md` H.D1 now carries a supersession note.** No behaviour, but a reader
   following that lock will now find the reason it no longer binds this program.
