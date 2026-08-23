# BRW-002 — Sandbox-local Playwright runtime — DESIGN

**Epic:** E8 · **Lane:** B (`C:\e8`) · **Start SHA:** this commit
**Terrain:** [`BRW-002-terrain.md`](./BRW-002-terrain.md) at `2dccddf4d` — read it first; five of
my own load-bearing claims were refuted there and this design is built on the corrections.
**Depends on:** BRW-001 ✅, WRK-004 ✅

**Outcome.** Launch Chromium/Playwright inside the sandbox without exposing CDP to other
tenants or the public network.
**Acceptance.** (a) browser process shares only the job sandbox; (b) downloads stay job
scoped; (c) browser and child processes die on cancellation.
**Test.** Deterministic local site navigation, download, popup, and kill.

---

## 1. The design in one paragraph

A **sandbox-local browser runtime**: a small, dependency-light orchestrator that runs *inside*
the job sandbox, launches Chromium through Playwright **over a pipe rather than a TCP port**,
confines every download to a per-job root, and is torn down by destroying the sandbox. It is
driven through **injected sandbox primitives** (`exec` / `writeFile` / `readFile`) rather than
being bound to either execution lane, because terrain showed the lane question is genuinely
unsettled and betting on one would strand the work. Its containment claims are proven by
**measuring the sandbox**, not by asserting the design.

## 2. The decision that reorders this ticket

Terrain's most useful correction: **the missing Chromium layer is not the first problem.**
Four independent things block a browser job today, and they are not equally in scope:

| # | Blocker | Owner |
|---|---|---|
| 1 | No per-workload template selection anywhere (`job-placement.ts:179-180` maps to a *capability*, never a template/image) | **deferred — see §7** |
| 2 | No browser in the template (`e2b/e2b.Dockerfile`) | **BRW-002 authors it; operator builds it** |
| 3 | No worker advertises browser capacity (`desktop-hello.ts:146-153` → `browserSessionSlots: 0`) | **deferred — see §7** |
| 4 | The workload never reaches the sandbox (`createSpecFor` drops browser fields) | **BRW-002, via §4.3** |

Blockers 1 and 3 only matter for **real-provider** execution, which is D3 — and D3 is
BRW-005's by three separate documents. BRW-002 is therefore scoped to **the runtime and its
containment proofs, proven deterministically**, with the real-E2B path declared as an operator
prerequisite rather than silently assumed. This is the difference between a ticket that closes
honestly and one that claims a capability nothing can invoke.

## 3. Clause (a) — "shares only the job sandbox"

### 3.1 CDP over a pipe, never a port

Terrain **measured** that E2B serves arbitrary in-sandbox ports to the public internet
unauthenticated — port 9222 included, HTTP 200, marker content returned. So the frozen
forbidden effect `public_cdp_endpoint` must be prevented at the source: **no debugging port
may ever be bound.**

Playwright's `chromium.launch()` already speaks to the browser over a **pipe**
(`--remote-debugging-pipe`) — a file descriptor pair, not a socket. Only `connectOverCDP`
requires a port. The design therefore uses `chromium.launch()` and never passes
`--remote-debugging-port`.

**Critically, "bind to 127.0.0.1" is NOT an acceptable alternative here** and the design
forbids it. The E2B edge terminates outside the guest, so loopback-binding reasoning that
holds on a normal host does not transfer. The probe is the authority, not intuition.

### 3.2 The guard is a measurement, not an assertion

A launch-args allowlist alone would be a check that cannot fail in the way that matters — an
arg could be added elsewhere, or Chromium could open a port for its own reasons. The real
guard measures the sandbox:

> **After the browser is launched, the set of listening TCP sockets inside the sandbox must
> contain nothing but the deterministic test site's port.**

Read with `ss -ltnH` (fall back to `/proc/net/tcp` parsing if `ss` is absent). This proves the
absence of a reachable endpoint rather than the absence of one spelling of one flag, and it
would catch a future Playwright/Chromium version that changed its default transport.

Two supporting guards, both cheap:
- a launch-argument guard rejecting `--remote-debugging-port` (and `--remote-debugging-address`)
  before spawn, so the failure is loud and early;
- an assertion that the runtime never calls `connectOverCDP`.

### 3.3 What this does NOT claim

Cross-tenant isolation of the E2B microVM itself is the provider's property and is DEP-008's
to certify. BRW-002 claims only: **this job's browser opens no reachable endpoint.** Stated
plainly so nobody later reads clause (a) as a proof of tenant isolation.

## 4. Clause (b) — "downloads stay job scoped"

### 4.1 The gap, precisely

Terrain: nothing confines a sandbox-produced file to a job by path. The artifact object-key
rules constrain the **destination** in object storage; the live capture path confines by
**enumeration** (`git diff`), so a download written elsewhere is *invisible, not confined*.
And the two path vocabularies are incompatible — `isSafeWorkspacePath` rejects a leading `/`
(`artifacts.ts:53`) while every in-sandbox path is absolute.

**Naming-collision trap, recorded so a later reader does not fall in:**
`artifactDownloadGrantV1Schema` is about the worker *pulling an artifact out of object
storage*, not about Chromium *saving a file from a website*. Clause (b) is the latter.

### 4.2 A per-job download root, set three ways

One mechanism is bypassable, so the root is imposed at three independent layers:

1. Playwright browser context: `acceptDownloads: true` + `downloadsPath: <root>`
2. Chromium: `--user-data-dir=<root>/profile` (so the profile's own default lands inside)
3. The profile preference `download.default_directory = <root>`

The root is derived from job identity the lease already carries — `ResourceLabels`
(`supervisor/provider.ts:72-82`) binds organizationId/jobId/attempt/leaseId — rooted under the
working directory the sandbox already owns. Never caller-supplied.

### 4.3 The missing sandbox-path adapter, and how config reaches the sandbox

A small `assertUnderRoot(root, candidate)` for **absolute** sandbox paths: rejects escape via
`..`, symlink traversal, absolute reassignment, and control bytes — mirroring the host-side
`assertCaptureRoot`/`normalizeRelPath` pattern rather than inventing one. Filenames from
`Content-Disposition` are sanitised before use; a `../`, an absolute path, and a NUL byte must
each either land inside the root or be refused, never escape.

**Config delivery.** `createSpecFor` degrades a browser workload to `args: []`, so the seven
frozen browser fields never reach the sandbox. Rather than edit E4's supervisor, the design
**stages the config as a file** (`writeFiles`) at a known sandbox path, which the in-sandbox
runtime reads. This avoids argv-escaping entirely, avoids touching another epic's module, and
is the same staging primitive CLI-002 already uses.

## 5. Clause (c) — "browser and child processes die on cancellation"

Terrain: `signal()` ignores its `kind` and returns `{delivered:true}` unconditionally, and
that maps to `outcome:"stopped"`, which the contract defines as *ends the process tree*. So
**cancellation must be built on `destroy`/`terminate`, never on `cancel`/`kill`.**

The test is therefore phrased as what is actually true — **"sandbox destroyed ⇒ browser and
children gone"** — not "browser killed", which the transport cannot deliver and which would
be a false claim of enforcement of exactly the kind this programme keeps finding.

Consequences the design accepts and states:
- **Trace/video/screenshot finalisation happens *during* the run, streamed.** Nothing may be
  deferred to a cancel handler, because there is no reliable cancel handler.
- Under cleanup authority, a browser session may be **destroyed** and **described**, but not
  one byte of screenshot, DOM snapshot, cookie/storage state, trace, video, or download may be
  read. That is the WRK-004 contract; BRW-003 must stream evidence before fence loss or lose it.
- Three things terrain could not verify are carried as **open risks, not assumptions**: that
  `Sandbox.kill` reaps a Chromium zygote/renderer tree (credible by microVM construction,
  proven by nothing in-repo); whether anything honours the frozen `deadlineMs: 20000`; and
  whether `browserSessionSlots` is returned on cancel. Each gets a named test or an explicit
  deferral in the result doc.

## 6. The deterministic test site

BRW-002's Test clause says "deterministic **local** site". Terrain refuted the idea that this
needs a D1 compose service — D1/D3 lane work is BRW-005's. So the site is an **in-sandbox
static HTTP server** on a fixed port, serving fixtures for exactly the four required cases:

| Case | Fixture |
|---|---|
| navigation | a page with a known title and a link to a second page |
| download | a link with `Content-Disposition`, plus hostile filenames (`../`, absolute, NUL) |
| popup | an anchor with `target=_blank` and a `window.open` button |
| kill | a page with a long-running timer, so a surviving process would be observable |

`/dev/shm`: Chromium's default 64 MB shm crash mode is unprovisioned anywhere in the tree and
cannot be sized through the E2B API, so the runtime passes `--disable-dev-shm-usage`. Recorded
because it is the classic silent-crash cause and would otherwise be diagnosed as flake.

## 7. Scope boundaries — declared, not discovered later

**In scope:** the runtime, the three containment mechanisms, their measured guards, the
in-sandbox test site, the four deterministic cases, and an authored browser Dockerfile.

**Explicitly deferred, with reasons:**
- **Per-workload template selection** (blocker 1) — needed only for real-provider execution,
  which is D3/BRW-005. Deferring is honest; silently assuming it would make BRW-002's tests
  pass while no browser job could ever be placed.
- **Worker browser capacity** (blocker 3) — same reason; `browserSessionSlots: 0` is a worker
  enrollment concern, not a runtime one.
- **The operator must build and register the browser template** before any real-E2B run. The
  Dockerfile is authored here; building it is an operator action, following the
  `keyed-e2b-conformance` precedent.
- **Egress policy is BRW-004's**, and terrain §6 records a design-blocking model mismatch
  there (the DAT-005 proxy is per-request and handle-bound; a browser emits raw DNS/TCP to
  runtime-discovered hosts). BRW-002 makes no egress claim.
- **Evidence capture is BRW-003's.** BRW-002 proves a browser runs and is contained; it does
  not stream observations.

## 8. Acceptance clause → named executable artifact

| # | Clause | Artifact |
|---|---|---|
| a | shares only the job sandbox | `browser-runtime-containment.test.ts` — post-launch listening-socket set contains only the test-site port; `--remote-debugging-port` refused before spawn; `connectOverCDP` never called |
| a | (real-provider evidence) | `packages/sandbox-e2b-provider/scripts/probe-e2b-port-exposure.mjs` + `keyed-e2b-cdp-probe.yml` — already landed; the standing proof that a bound port *would* be public |
| b | downloads stay job scoped | `browser-download-scoping.test.ts` — download lands under the per-job root; `../`, absolute, and NUL filenames refused or contained; all three layers set |
| b | path adapter | `sandbox-path-adapter.test.ts` — escape, symlink, control-byte and absolute-reassignment cases |
| c | dies on cancellation | `browser-lifecycle.test.ts` — sandbox destroy ⇒ no surviving browser/child; asserts the `cancel`-is-inert reality rather than assuming a tree-kill |
| Test | navigation / download / popup / kill | `browser-deterministic-journey.test.ts` against the in-sandbox site |

**Guards to mutation-test:** the listening-socket assertion, the debugging-port argument
guard, `assertUnderRoot`, the download-filename sanitiser, and the destroy-not-cancel
lifecycle branch.

## 9. Honest risk

The worker-daemon lane is **dormant** — `createSupervisor`, `createPollLoop`,
`E2bSandboxProvider` and `createResultCommitter` all have zero production callers. A test
written directly against those would pass and prove nothing about a live browser. Every test
above therefore names its injection point and states why it exercises the real path. This is
the programme's signature defect class and the reason the runtime takes injected primitives
rather than importing a dormant supervisor.
