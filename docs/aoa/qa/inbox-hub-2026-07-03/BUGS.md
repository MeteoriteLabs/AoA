# Inbox/Approvals Hub — Bugs (2026-07-03 live QA)

## BUG-1 — codex_local runtime-decision run dies at app-server handshake (crown-jewel loop never starts)
Scenario: 6.1 (and blocks 6.2, 6.3, 6.4, 6.6, 6.7, 6.9 — all codex runtime-decision scenarios)
Severity: BLOCKER
Repro:
1. Company A (local_trusted), agent Scout-Codex with adapterType=codex_local, runtimeConfig.runtimeDecisionRoutingEnabled=true. AOA_RUNTIME_DECISION_ROUTING=1.
2. Create a task assigned to Scout-Codex, status=todo, workMode=standard (auto-dispatches a wakeup). Task: QAL-1, instructs a risky network command.
3. Heartbeat run 8a5bdeba-681b-49b9-92a1-afaec2caaa29 starts and FAILS in ~250ms.
Expected: codex app-server starts a session, hits the sandboxed/network command, raises an `item/commandExecution/requestApproval` server request → AoA routes it to an `agent_runtime_decision` hub item in "Waiting on you". Founder clicks Allow once → decision relays → run proceeds.
Actual: run status=failed, error="Invalid request: missing field `params`". No session ever starts; no command runs; "Waiting on you" lane stays empty ("No open items in this lane"). A `run_failed` notification IS raised (Notifications lane).
Root cause (precise): codex-cli 0.130 app-server rejects the very first JSON-RPC request. `driver.ts:305` calls `client.request("initialize")` with NO params. `jsonrpc-client.ts:212-219` builds the frame as `{ jsonrpc, id, method, params }` where `params` is `undefined`, so `JSON.stringify` OMITS the `params` key from the wire frame. codex 0.130's app-server requires `params` to be present on `initialize` and returns a JSON-RPC error, which surfaces via the error-response path at `jsonrpc-client.ts:148-151`.
Evidence:
- Run log: C:/Users/TK/.aoa/instances/qa-inbox-e2e/data/run-logs/.../8a5bdeba-...ndjson (line 5: "[aoa] Ignoring config.dangerouslyBypassApprovalsAndSandbox on the supervised (runtime-decision) codex path — approvals are human-gated." — confirms supervised path engaged)
- server.log:4075-4089 (full stack: dispatch @ jsonrpc-client.ts:150 ← onChunk @ jsonrpc-client.ts:196)
- SHOT-6.1-waiting-lane.png (empty waiting lane)
Suspected file:
- packages/adapters/codex-local/src/server/app-server/driver.ts:305 (initialize sent without params)
- packages/adapters/codex-local/src/server/app-server/jsonrpc-client.ts:212-219 (frame omits undefined params key)
Notes: This matches the memory note that W5c (codex exec→app-server re-platform) is gated on a live app-server spike and not yet functional. The runtime-decision hub SURFACE could not be exercised at all via codex because no run survives the handshake. WORKAROUND for QA: claude_local exercises the same hub surface successfully (see 6.1-claude PASS).

## BUG-2 — Runtime-decision hub items never reconcile to resolved when the underlying decision terminates
Scenario: 6.1-claude / 6.6 / 6.7 (three termination paths)
Severity: MAJOR
Repro:
1. Drive Scout-Claude to raise a runtime_decision permission (agent_runtime_decision hub item, status=open).
2. Cause the underlying decision to reach a terminal state by ANY of: (a) answer allow_once (decision→answered→relayed, run completes), (b) let it expire (decision→cancelled at SLA), (c) cancel the run (decision→cancelled via teardown).
3. Re-read the waiting_on_you lane.
Expected: once the underlying agent_runtime_decision is terminal (answered/relayed/cancelled/expired), the projecting hub item should leave the "Waiting on you" Open list (resolved/archived).
Actual: the hub item stays status=open indefinitely. Confirmed for decision 05778b47 (cancelled/expired → hub item 9b9c5f27 stayed open), decision 208771e9 (cancelled via run-cancel → hub item stayed open). The decision record itself DOES reach terminal state correctly (server-side lifecycle is right); only the hub-item projection is stale.
Impact: founder sees phantom "Waiting on you" permission items for runs that already finished/cancelled/expired. Clicking one and answering yields a 409 (already-settled). Inflates the waiting badge (observed badge "4" vs 1 real live item).
Evidence: decision 05778b47 status=cancelled while hub-item 9b9c5f27 status=open; decision 208771e9 status=cancelled while its hub item status=open (both via GET /api/companies/:cid/hub-items).
Suspected file: the hub-item source producer/reconciler for sourceType=runtime_decision (server/src/services/hub-* / hub-source-producers), and/or the answer/expire/cancel side-effect that should close the projected hub item. Note: the answer-completion case sometimes DID archive (hub item 6b563ec5→archived after allow), so reconciliation is inconsistent — it fires on some relays but not on expire/cancel or on decisions superseded within a still-running run.

## BUG-3 — InboxHub floods the browser with polling requests → ERR_INSUFFICIENT_RESOURCES, stalls user POSTs
Scenario: 6.1-claude (UI Allow-once), general hub usage
Severity: MAJOR
Repro:
1. Open the Inbox Hub in a browser and leave it on the waiting lane while activity occurs.
2. Watch the browser console/network.
Expected: bounded background polling that doesn't exhaust the HTTP connection pool.
Actual: a burst of GET /hub-items/counts + /sidebar-badges + /notifications/digest/me + per-item GET /hub-items/:id requests saturates the browser's ~6 concurrent-connection limit; console fills with net::ERR_INSUFFICIENT_RESOURCES; new requests (including the user's POST /agent-runtime-decisions/:id/answer) sit "pending" and never get a socket. Server log shows 3222 counts/badges/digest requests over the session. During the UI Allow-once attempt the answer POST never completed (stuck pending) — I had to answer via API to prove the relay.
Impact: the Allow-once/Deny UI action can silently fail to send under load; degraded/unusable hub under sustained activity.
Evidence: `browse console --errors` (ERR_INSUFFICIENT_RESOURCES flood at 16:59:28 and 17:16:25), `browse network --failed` (many pending counts/badges/digest/item GETs), server.log grep count = 3222.
Suspected file: InboxHub.tsx polling/refetch effects (counts + sidebar-badges + digest + open-item detail); likely missing dedupe/backoff or too-tight refetchInterval, plus per-item refetch on every list tick.

## BUG-4 — Server SPA fallback 404s on hard-navigation to deep hub/app routes
Scenario: 2.1 (and any bookmarked deep link / full reload)
Severity: MINOR (client-side nav works; only hard load / bookmark / reload breaks)
Repro:
1. curl or browser hard-load http://localhost:3399/QAL/home or /QAL/inbox-hub/waiting.
Expected: server returns index.html (SPA fallback) so the client router can render.
Actual: HTTP 404 with body {"error":"Not Found"}; the browser renders a Not Found page. Client-side navigation (clicking nav links) works fine; only initial hard load of a deep path fails. `/` (root) returns 200.
Impact: bookmarks, shared deep links, and page reloads on any /:prefix/... route land on a 404. Deep-link acceptance (matrix §9.1) is undermined for hard loads.
Evidence: curl -o /dev/null -w %{http_code} → 404 for /QAL/home and /QAL/inbox-hub/waiting; 200 for /.
Suspected file: server SPA catch-all / static-serve middleware (server/src/app.ts static handler) — the fallback route isn't matching company-prefixed paths in this QA build. NOTE: may be a QA-build artifact (UI served differently than prod); verify against a prod build before filing as product.

## BUG-5 — No run_complete notification emitted for a successful claude heartbeat run
Scenario: 5.1
Severity: MINOR
Repro: dispatch a task to Scout-Claude that completes (run status=succeeded). Check Notifications lane.
Expected: a run_complete notification.
Actual: Notifications lane shows only the codex run_failed item; no run_complete for the succeeded claude run (Scout-Claude run 9e6baefe succeeded, task went in_progress). run_failed IS emitted (codex). 
Impact: founder gets no positive confirmation a run finished via the hub.
Evidence: GET hub-items?lane=notifications → only [('run_failed','open')] after a succeeded claude run.
Suspected file: heartbeat run-completion → notification emit path (only failure path wired, or success emit gated). Verify whether run_complete is intentionally suppressed for non-terminal task outcomes (run succeeded but task stayed in_progress, not done).
