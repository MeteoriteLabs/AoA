import { test } from "@playwright/test";

/**
 * provider-switching.spec.ts  (Unit 11 — Part C)
 *
 * PLACEHOLDER — deferred pending local Playwright verification.
 *
 * WHY DEFERRED:
 *
 * The provider-switching engine is fully tested at two lower levels:
 *   - Pure/contract:  server/src/__tests__/provider-switching-parity.test.ts
 *                     (9 passing tests, locally green)
 *   - Integration:    server/src/__tests__/provider-switching.integration.test.ts
 *                     (7 tests, skipped on Windows, runs on Linux CI)
 *
 * Authoring a Playwright spec for the agent-config form would require knowing
 * the exact selectors for the model input, adapter-type selector, and save
 * button inside the AgentSlideOver / AgentConfig UI. There is NO existing
 * agent-adapter-config e2e spec in this repo to mirror (the closest analogues
 * are onboarding-thread-pipeline.spec.ts and commander-codex-reply.spec.ts,
 * which cover different UI surfaces). Guessing selectors would produce a
 * likely-broken spec that fails CI — worse than a documented deferral.
 *
 * INTENDED SCENARIOS (to implement once selectors are confirmed):
 *
 * 1. PERSIST — change a codex_local agent's model, save; assert the new model
 *    appears in a subsequent GET /api/companies/:cid/agents/:id response and
 *    is rendered in the model input on re-open.
 *
 * 2. CROSS-FAMILY VALIDATION — attempt to save a claude_local model string
 *    ("claude-sonnet-4-5-20250929") on a codex_local agent's model field;
 *    assert an inline validation error or 400 API response renders (the
 *    backend's shell-safety + adapter-specific gate should reject it before
 *    the runner touches it).
 *
 * 3. AUTH-MISMATCH WARNING — configure a codex_local agent with model
 *    "gpt-5.3-codex"; if the UI surfaces a "not supported on your plan" /
 *    "will be auto-corrected" inline warning, assert it is visible. If the
 *    warning is server-side only (in the run-summary comment), check the
 *    comment text after a fake-codex turn instead.
 *
 * HOW TO IMPLEMENT:
 *   1. Locally run the e2e suite with `pnpm aoa onboard --yes --run` on :3199.
 *   2. Navigate to /{prefix}/team/agents/:id in Chromium DevTools and inspect
 *      the model input, adapter selector, and save button — confirm test-id
 *      attributes (or aria-labels) are present.
 *   3. Add data-testid attributes if missing (cheap one-liner in the React component).
 *   4. Replace the test.skip stubs below with full test bodies.
 *
 * PLATFORM NOTE:
 *   The playwright config already excludes ALL *.spec.ts files on Windows
 *   (when DATABASE_URL is absent) via testMatch → windows-embedded-postgres-
 *   skip.spec.ts. No per-spec guard is needed here.
 */

test.describe("provider-switching UI (placeholder — deferred)", () => {
  test.skip(
    "1: codex_local agent model change persists (change + save → GET confirms new model)",
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    async () => {},
  );

  test.skip(
    "2: cross-family model (claude string on codex_local agent) renders validation error",
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    async () => {},
  );

  test.skip(
    "3: ChatGPT-incompatible model (gpt-5.3-codex on subscription account) renders auth-mismatch warning or is auto-corrected in run summary",
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    async () => {},
  );
});
