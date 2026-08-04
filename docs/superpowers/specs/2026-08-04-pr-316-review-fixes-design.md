# PR 316 Review Fixes Design

**Date:** 2026-08-04

## Goal

Resolve the three actionable findings from the PR 316 review without changing the accepted deferred cloud/runtime scope:

1. Make company-bundle import work for a user who can create companies in more than one Organization.
2. Refresh plugin UI contributions immediately after lifecycle changes that can alter those contributions.
3. Show the cloud provider-key guidance in the reachable cloud onboarding verification flow.

All regression tests and final validation run through the repository's Docker test harness. The harness may be extended when a missing capability prevents these tests from running, but harness-only changes must stay outside the product diff unless they are generally useful and belong in the repository.

## 1. Organization Destination for Company Import

### Behavior

`CompanyImport` loads the signed-in user's active Organization memberships from `GET /api/organizations` and filters them to the server's company-creation roles: `owner` and `admin`.

- One eligible Organization: select it automatically.
- More than one eligible Organization: show an import-only destination selector and require a selection before previewing or importing.
- No eligible Organizations on `cloud_auth`: show a clear message that the user needs owner/admin access and disable preview/import.
- No memberships on self-hosted modes: preserve the existing single-tenant fallback by omitting `organizationId` and letting the server resolve the sentinel Organization.

When an Organization is selected, its `organizationId` is sent in `target` for both preview and final import. Changing the destination clears an existing preview so the final import cannot accidentally reuse a plan generated for another tenant.

### Organization labels

The membership-list response will include the Organization's display name and slug alongside the membership. The server will join only Organizations for which the caller has an active membership, preserving the existing scope boundary. The additive flat fields let the UI disambiguate duplicate names while leaving the endpoint's membership-list shape intact.

### Security boundary

The picker is convenience, not authorization. The server remains authoritative and continues to require `company:create` on the exact supplied Organization. No Organization is inferred when multiple memberships exist.

## 2. Plugin Contribution Cache Coherence

Create one local invalidation helper in `PluginDetailSlideOver` that invalidates both:

- both installed-plugin list keys currently used by Settings and Marketplace; and
- `queryKeys.plugins.uiContributions(companyId)`.

Use it after successful enable/disable, activation retry, completed upgrade, approved capability-delta upgrade, and successful capability-upgrade rollback, because each can change plugin state or which routes, sidebar entries, and UI slots are active. Use the same invalidation when reconciling a server-reported cloud execution block so cached contribution UI cannot outlive the newly blocked state.

Invalidation remains company-scoped; no global plugin cache flush is introduced.

## 3. Reachable Cloud Provider-Key Guidance

`CloudDeferredStep` accepts optional supporting content inside its card. `CloudAwareVerifyStep` supplies `CloudProviderKeyNotice` for `cloud_auth`; the environment step does not duplicate it. Self-hosted verification continues to render `VerifyStep`, where the notice remains a no-op outside cloud mode.

The notice stays non-blocking and continues to link to Settings → Providers. Its wording does not claim that provider keys enable extraction, preserving Decision #104's CLI-only extraction boundary.

## Error Handling

- Organization-list failures surface an inline error and keep preview/import disabled rather than falling back to an ambiguous request.
- A stale or revoked Organization selection can still be rejected by the server; the existing API error display remains visible.
- Plugin invalidation is best-effort cache synchronization after a successful mutation and does not change mutation error semantics.
- Cloud onboarding continues even when a provider key has not been configured.

## Test Strategy

Regression tests are written before implementation and must demonstrate the old failure:

1. `CompanyImport` tests cover automatic single-Organization selection, named/slugged multi-Organization selection, cloud zero-eligible blocking, self-hosted empty-membership compatibility, destination propagation to preview/import, and preview clearing when the destination changes.
2. Shared portability type tests cover the already-supported `organizationId`; Organization route/service tests cover scoped membership display names/slugs without leaking unrelated Organizations.
3. `PluginDetailSlideOver` tests assert both installed-plugin representations and the UI-contribution query key are invalidated after contribution-changing lifecycle actions.
4. `CloudDeferredStep` tests assert the provider-key notice appears in the cloud verification branch and does not appear in the cloud environment or self-hosted branches.

Focused red/green runs, relevant surrounding suites, typecheck, and build run inside Docker. The final report distinguishes product failures from harness/infrastructure failures and records any harness changes made to support the run.

## Non-goals

- Reworking the separate "create another company" beta flow or replacing its current no-picker behavior.
- Adding provider-key support to extraction.
- Implementing cloud plugin workers, gVisor worker pools, break-glass endpoints, RLS expansion, or any other explicitly deferred PR 316 item.
- Changing server-side Organization authorization or tenant inference rules.
