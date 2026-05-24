# Threads — App-wide Infra Follow-up (handle AFTER the implementation plan)

> These are **app-wide infra** concerns (serve *all* features, not just Threads) surfaced during the Threads spec.
> **Decision:** the crew **"brakes" (SPEC §4.1) are in the v1 plan**; these **infra items are documented here to revisit in a separate effort** once the plan is done.
> **Update (pulled into v1):** the single-instance / app-level slices of **#3** (per-thread scoping + envelope RBAC) and **#5** (per-role model + extract/classify cost-caps) are now in the v1 plan (SPEC §6.2 / §4.1 / §4.2). What stays below for #3 and #5 is only the **multi-instance / high-volume residue**.
> None block the v1 *design*. Some block *cloud/multi-user production* (flagged). Take this doc to the dedicated infra chat.

---

## 1. Real-time scale — pub-sub backbone (Redis/NATS)
- **Today:** in-process `EventEmitter` (`live-events.ts`) — **single server only**; a 2nd instance behind a load balancer misses events.
- **Need:** a pub-sub backbone so events fan out across instances.
- **Decide:** Redis vs NATS · channel model (per-company / per-thread) · ops cost.
- **Blocks:** horizontal scale (multi-instance cloud). *Single-instance works without it.*

## 2. Live preview — auth'd proxy (the URL/port problem)
- **Today:** iframe loads `localhost:<port>` on the **viewer's** machine — local-only; no proxy, no preview auth, no concurrency mgmt; AoA CSP `frame-ancestors:'none'` blocks same-origin framing.
- **Need:** a **preview proxy with AoA auth** — path (`/preview/:id/*`) vs subdomain (`<id>.preview.app`); WebSocket/HMR proxying; CSP carve-out; **idle-stop + concurrency/port cap**.
- **Decide:** path vs subdomain · where dev servers run (co-located vs sandbox tier) · lifecycle caps. **Solve once for BOTH Execution Workspaces and Threads.**
- **Cheap wins independent of this (ship in v1):** unfurl cards + static **sandboxed-iframe** (no port) cover most thread previews.
- **Blocks:** *live* previews for remote/cloud/multi-user. *Local-trusted works without it.*

## 3. Event-stream RBAC + per-thread scoping  ·  ⬆ PARTIALLY PULLED TO v1
- **Moved into v1 (SPEC §6.2):** **per-thread scoping** (clients subscribe to the threads they view) + **envelope RBAC** (server filters every event by recipient permission at fan-out, so a user never gets even a poke about a thread they can't see). Single-instance, app-level, no Redis — closes the **private-thread metadata leak** the moment v1 ships private/Unlisted threads.
- **Moved into v1.1 (SPEC §6.2):** **payload-level RBAC** for **content push-deltas** (filter the *content* per recipient once we send content, not just a poke, over the socket). An optimization over the already-safe refetch model.
- **Remaining here (infra):** the **cross-instance** version — making per-thread scoping + RBAC work across 2+ servers — which rides on the pub-sub backbone in **#1**. Nothing extra to decide separately from #1.

## 4. Embeddings provider strategy
- **Today:** Provider-SDK utilities exist; provider + key source need deciding (Commander stance = "no per-company key").
- **Need:** choose **hosted** (API key — instance/company level) vs **local/self-hosted** embed model (privacy, no per-token cost).
- **Decide:** provider · key source · per-token budget — or a local model + its ops.
- **Blocks:** embeddings/extraction at scale + cost control. **v1 default is decided** (hosted SDK path + graceful Postgres-FTS fallback when no key — SPEC §4.2); what remains here is the *strategy* (which hosted provider, or a local model + its ops).

## 5. LLM-at-scale tuning  ·  ⬆ PARTIALLY PULLED TO v1
- **Moved into v1:** **per-role model choice** (cheap model for Router classify, stronger for Scribe extract — plain config, part of building the roles; SPEC §4.2) + **per-call cost-caps** on classify/extract (folds into the §4.1 cost-accounting brake; SPEC §4.1).
- **Remaining here (infra):** **batching/coalescing** of classify/extract calls at **high volume** — a throughput optimization that only matters past v1 scale (one founding team, one instance). Basic debounce already exists in the event listener. Revisit alongside **#4** (embeddings provider) when tuning cost at scale.

---

## Check-after-plan
Once the v1 plan is drafted: confirm which of these the **target deployment** actually needs (local-trusted single-instance vs cloud multi-user), then sequence the infra accordingly. The v1 **design**, the crew **brakes (§4.1)**, and the now-pulled-in **#3 / #5 v1 slices** do **not** depend on the remaining infra being done first — except a **basic embeddings provider** (#4) for core functionality.
