# Testing remote CLI authentication

Target: `https://testing.armyofagents.org`

This is a protected release gate. Never paste a live key into logs, screenshots,
issue comments, or CI output.

## Preconditions

- Record the expected deployed Git SHA.
- Confirm `AOA_INSTALL_PROFILE=remote_single_tenant`.
- Confirm exactly one server/login-worker replica is active.
- Confirm `AOA_SCOPED_CLI_AUTH=true` and a stable
  `AOA_EXECUTION_TARGET_ID` are set.
- Run `aoa doctor --json --offline` inside the application container and retain
  only its redacted topology/version result.
- Use a disposable company and test tasks with no connectors, tools, private
  prompts, or customer data.

## Campaign

Assign a unique campaign ID such as `cli-auth-YYYYMMDD-HHMM`.

For each method, start from a revoked/empty campaign-owned credential and
require the onboarding Verify step to complete a real hello probe:

1. Codex ChatGPT subscription using device code.
2. Claude subscription using the pasted authorization code.
3. OpenAI API key.
4. Anthropic API key.

For subscription methods, close onboarding immediately after provider success,
then reopen it. The credential must already be verified and bound to Commander.
Attempting to bind it to an ordinary agent must return
`subscription_commander_only`.

For API-key methods, use a disposable provider key with a hard provider-side
spend limit. Confirm an invalid, revoked, and quota-exhausted key each produce a
specific non-ready classification and never advance onboarding.

## Execution proof

For each verified method:

1. Create one campaign-named task containing only `Respond with hello.`
2. Run it through the normal bounded heartbeat path.
3. Require a terminal successful run with non-empty output.
4. Record provider, model, timestamps, run/task IDs, deployed SHA, and outcome.
   Do not record prompts beyond the fixed string or any credential material.

Stop at the provider probe if egress, tool disabling, timeout, or cost limits
cannot be proven for that adapter.

## Negative and lifecycle checks

- Cancel and restart a pending challenge.
- Restart the server during a pending challenge; the old challenge must expire
  and the UI must offer a clean restart.
- Start two challenges for the same scoped provider home; exactly one may remain
  pending.
- Switch accounts during a pending challenge; the previous user's challenge
  must be cancelled and no company/session state may leak.
- Check 320px width, 200% zoom, keyboard-only recovery, reduced motion, and long
  verification errors. The primary action must remain reachable.

## Redaction and cleanup

Search server logs, activity rows, browser console output, HTTP error bodies,
screenshots, and any evidence manifest for key/token/code patterns. Fail the
campaign if any credential, authorization URL query, or credential path appears.

Cancel campaign runs and challenges, revoke campaign keys, remove only
campaign-owned scoped credentials and disposable resources, and verify their
absence. Record cleanup status beside the campaign ID.
