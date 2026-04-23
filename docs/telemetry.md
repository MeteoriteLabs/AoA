# AoA Telemetry

AoA supports optional feedback-vote and plugin-telemetry transmission to a
customer-controlled HTTP endpoint. Disabled by default; when unset, all
payloads stay on the instance's local filesystem.

## Configuration

Set at deployment time (environment variables):

- `AOA_FEEDBACK_ENDPOINT` — HTTPS URL that accepts `POST` with a JSON body
- `AOA_FEEDBACK_API_KEY` — optional; when set, sent as `Authorization: Bearer <key>`

Unset `AOA_FEEDBACK_ENDPOINT` → local-only mode. Feedback bundles write to
`~/.aoa/feedback-exports/<exportId>-<timestamp>.json.gz`; plugin telemetry
events log at debug level and are discarded.

## Transmission semantics

### Feedback vote bundles

- Operator sets `AOA_FEEDBACK_ENDPOINT` + (optional) `AOA_FEEDBACK_API_KEY`.
- When a vote completes and the instance preference is `allowed`, the host
  builds the bundle (with redaction) and calls `shareFeedbackBundle`.
- If the POST succeeds (2xx), no local copy is written — operators who want
  an audit trail should tee on their side.
- If the POST fails (non-2xx or network error), the host falls back to the
  local-fs write path. Votes are never lost on transient outages.

Payload shape: `FeedbackShareBundle` envelope — see
`buildFeedbackBundle` in `server/src/services/feedback-bundles.ts`.

### Plugin telemetry events

- Plugins call `ctx.telemetry.track(eventName, dimensions)` from their worker.
- The host validates the event name (`/^[a-z0-9][a-z0-9_-]*$/`) and
  hands it off to `transmitPluginTelemetry`.
- If `AOA_FEEDBACK_ENDPOINT` is unset, transmission is a no-op; the host
  still logs the event at debug for local observability.
- If set, the POST is fire-and-forget with envelope:

```json
{
  "kind": "plugin_telemetry",
  "event": "sync_completed",
  "dims": { "attempts": 2 },
  "timestamp": "2026-04-23T10:30:00.000Z"
}
```

- The plugin never observes transport outcome — `track` resolves as soon as
  the POST is launched.

## Redaction

AoA runs the full redaction pipeline (`feedback-redaction.ts`, 9 patterns:
email / API keys / JWTs / PEM blocks / phone / GitHub tokens / DSN / AWS
access keys / OpenAI keys) **before** handing the bundle to
`shareFeedbackBundle`. Endpoints should not re-implement redaction; the
payload they receive is already scrubbed.

## Disabling

Unset `AOA_FEEDBACK_ENDPOINT` (or clear the variable and restart the server)
to return to local-only mode. No data in flight is lost — the fall-through
is the same durable local write that backs the fallback path.

## Notes for endpoint implementers

- Accept `POST` + `Content-Type: application/json`.
- 2xx → bundle consumed; AoA will not retry or persist locally.
- Non-2xx → AoA persists locally and logs the failure. Rate-limit responses
  (429) are not special-cased; they fall through to local the same way 5xx
  would.
- `Authorization: Bearer <AOA_FEEDBACK_API_KEY>` is present iff the env var
  was set at AoA startup.
- Envelope shapes (feedback vs plugin_telemetry) are disjoint — route on
  the `kind` field for `plugin_telemetry`; the vote envelope uses
  `schemaVersion: "paperclip-feedback-envelope-v2"`.
