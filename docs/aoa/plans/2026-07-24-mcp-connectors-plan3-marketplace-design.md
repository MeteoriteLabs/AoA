# Plan 3 — Marketplace Connectors (Design)

**Date:** 2026-07-24
**Branch:** `integration/connectors-marketplace`
**Status:** design approved, implementation plan not yet written
**Depends on:** Plans 1 + 2 + 2b (complete, `53180c129`) and `feat/viewer-upgrade`'s `marketplace-install/` rewrite (in flight)
**Decisions:** extends #110 (connectors) and #96 (two-repo catalog schema). Decision #97
(`derivePackages`) is **not** affected — package synthesis is skill-items-only and
connectors are excluded from it.
**Follow-ups:** `docs/aoa/plans/mcp-connectors-followups.md`

---

## 1. Problem

Plans 1/2/2b built the entire connector runtime: a founder can register an external MCP
server and it is delivered to heartbeat agents, crew agents, and Commander across all four
CLI adapters, with secrets held in process env rather than on disk.

What is missing is **discovery**. Today the only way to add a connector is
Settings → Connectors → Add, typing the URL, transport, header template and token by hand.
That is acceptable for a founder who already knows exactly which MCP server they want and
how it is configured. It is not a product.

Plan 3 makes connectors discoverable: a curated shelf you can browse and install in one
click, and a search box that reaches the ~9,600-server public MCP registry for everything
else.

---

## 2. Shape

Three commitments define the design:

1. **Curated connectors are a first-class marketplace item type.** They browse, they have
   cards, they install in one click, and they go through the same install orchestrator as
   skills/agents/teams/plugins.
2. **The long tail is a search, not a shelf.** Registry entries are never bulk-imported
   into the catalog (see §3.2 for the measurement that forces this).
3. **Nothing reaches an agent implicitly.** An installed connector is inert until the
   founder supplies credentials *and* opts a specific agent in.

Sizing: **~20–40 curated connectors** ship in Plan 3 (Notion, Linear, Slack, Sentry,
Postgres, GitHub, Figma, Stripe and similar) — enough that the shelf feels real on day one,
few enough that each can genuinely be vetted. Further curation is follow-up work, not a
blocker.

---

## 3. Key measurements that shaped this

### 3.1 The install dispatch is a single switch

`server/src/services/marketplace-install/orchestrator.ts:211-252` dispatches on
`catalogItem.type` across `skill` / `agent` / `team` / `plugin`. Adding connectors means
adding one case there — which is also why this plan is coupled to `feat/viewer-upgrade`,
which is currently rewriting that file.

### 3.2 The catalog is downloaded whole, and filtered in the browser

`ui/src/api/marketplace.ts:105` is `api.get<MarketplaceCatalogFile>("/marketplace/catalog")`
— the entire catalog file. Every filter and sort (`marketplace.ts:197/226/252`) is a pure
client-side function. There is **no server-side search or pagination anywhere.**

Measured against the live CDN catalog on 2026-07-24:

| | value |
|---|---|
| catalog size | **1,544,110 B (1.47 MB)** |
| items | **514** (498 skill, 11 agent, 4 plugin, 1 team) |
| avg bytes per non-skill item | **2,154 B** |

Projection if the ~9,600-entry registry were snapshotted into that file:

| entry density | added | new total |
|---|---|---|
| lean (400 B) | +3.7 MB | **5.1 MB** |
| today's (2,154 B) | +19.7 MB | **21.2 MB** |

Every founder's browser would download that on every marketplace visit, and it would also
land in `marketplace_catalog_cache` and in the build-time snapshot bundled into the UI.

**Conclusion: bulk import is rejected.** The client-side-filter architecture is correct for
~500 curated items and breaks around ten thousand. The long tail becomes a server-side
search endpoint instead — which is also how people actually find a connector. Nobody
scrolls 9,600 cards; they type "jira".

This scaling limit is a property of the marketplace generally, not of connectors. It is
recorded in the follow-up register as a constraint any future large-catalog work inherits.

---

## 4. Architecture

### 4.1 Catalog schema (two-repo, Decision #96)

Add `"connector"` to `MarketplaceItemTypeSchema` (`packages/shared/src/marketplace.ts:43`),
and a connector spec carrying:

- `transport`: `"http" | "stdio"`
- `url` (http) or `command` + `args` (stdio)
- **header template keys only** — never values, never a credential
- which secret the founder must supply (name + human label + docs URL)
- `verified: boolean`

Mirrored in `MeteoriteLabs/aoa-marketplace-cdn` as `content/connectors/<slug>/connector.json`.

Two rules are load-bearing:

- **`verified` is fail-closed.** Absent ⇒ community. It may be set *only* in the
  AoA-controlled catalog repo and must never be read from registry-supplied metadata —
  otherwise any registry publisher marks themselves verified and the trust tier evaporates.
- **Absent fields must be tolerated** (Decision #96) so a CDN schema bump cannot break
  older AoA instances.

### 4.2 Install path — reuse, do not fork

The `connector` case in the orchestrator calls the **existing** `mcpConnectorService`
(`server/src/services/mcp-connectors-crud.ts`) to create a `company_mcp_connectors` row.

No parallel write path. Everything already built and reviewed applies unchanged:

- **D6 approval gate** — `local_trusted` auto-approves; `authenticated` queues an
  `install_mcp_connector` approval, which remains the sole activation path (C2).
- **D7 transport gate** — `assertTransportAllowed` still gates stdio by deployment mode.
- **Secret handling** — D5 env indirection; the catalog never carries a credential.

**New status `needs_credentials`:** installed, visible, and **never delivered to any
agent**. The founder supplies the token in Settings, after which the row proceeds to
`active` (or `pending_approval` under D6).

`source` is set to `"marketplace"` **server-side**. It is never accepted from the client —
this follows the C3 precedent from Plan 1, where trusting a client-supplied `source` was a
reviewed vulnerability.

### 4.3 Registry search

`GET /marketplace/connectors/search?q=` proxies the official MCP registry server-side,
caches responses, normalises entries into the same connector spec, and **forces
`verified: false`** on every result.

Failure behaviour: registry unreachable ⇒ search degrades with a clear message; curated
browsing is unaffected. Offline and air-gapped instances therefore keep the curated shelf
and lose only search. (Confirmed relevant: `registry.modelcontextprotocol.io` was
DNS-unreachable from the development sandbox.)

### 4.4 The stdio consent gate — server-enforced

Installing an **unverified stdio** connector requires an explicit acknowledgement carrying
the exact command to be run, and **the route rejects the install without it.**

The rationale is the difference between hand-configured and catalog-installed connectors.
A stdio connector spawns a process on the AoA host with the server's privileges;
`npx -y <pkg>` downloads and executes code from npm at run time. Until now the founder
always typed that command themselves, so consent was implicit in the act of typing. A card
with an Install button removes that property, and the config arrives as data from a CDN or
registry the founder never reads.

The gate must live in the route, not the dialog. A UI-only confirmation is theatre —
anything that can POST bypasses it.

Note the case that motivates this most: **secretless stdio connectors have no credential
modal**, so without this gate the sequence is click → code executes → no prompt at any
point. Per D6, `local_trusted` — where D7 permits stdio — is the default deployment mode
for solo founders.

### 4.5 Agent exposure

Unchanged from D3/D4: a marketplace install enables the connector for **no crew agents**;
the founder opts each in. Commander receives all `active` connectors automatically.

### 4.6 UI

- Connector cards with a type filter, matching existing card chrome
  (design-system §9.13–9.18).
- A search box whose results are visually distinct and explicitly labelled unverified.
- A **"Needs setup"** badge that deep-links to Settings → Connectors.

The badge should share a surface with the connector-health work in follow-up FU-1 — both
answer the same founder question, "why isn't this connector working?"

---

## 5. Error handling

| Condition | Behaviour |
|---|---|
| Registry unreachable / times out | search degrades with a message; curated unaffected |
| Catalog missing connector fields | tolerated; entry renders with what is present (Decision #96) |
| stdio blocked by D7 for the deployment mode | install refused with the deployment-mode reason |
| Unverified stdio install without consent token | route rejects (400) — not a UI-level check |
| Connector installed but unconfigured | `needs_credentials`, badge shown, never delivered |
| Approval pending (authenticated mode) | `pending_approval`; only approval activates (C2) |

---

## 6. Testing

Full-stack coverage is a requirement of this plan, not a nicety. Every review round in
Plans 1/2/2b found a real defect that passed first-pass green tests — an RCE chain, an
arg-injection bypass, a data-loss bug, and silently-unauthenticated connectors — and three
of those four were in the adversarial category.

| Layer | Coverage |
|---|---|
| **Unit** | schema parse with absent fields; `verified` fail-closed; registry→spec normalisation; consent-token validation |
| **Contract** | search + install API shapes (existing `*-routes-contract` pattern) |
| **Service** | install dispatch via sequence-based mock DBs (house pattern, see CLAUDE.md § Test Patterns) |
| **Integration** (embedded-PG) | install → `needs_credentials` → add secret → `active` → loader delivers to a real run |
| **E2E** (Playwright) | browse → install → badge → configure. Linux is the required gate; **Windows e2e is skipped** (Issue #114) so this cannot be verified locally |
| **Adversarial** | unverified stdio rejected without consent; `verified` uninjectable from registry data; prototype pollution via connector names; reveal panel cannot be used to spoof a command; client-supplied `source` ignored |

---

## 7. Risks and dependencies

1. **`feat/viewer-upgrade` must land first.** It is rewriting `marketplace-install/`
   (orchestrator, team-installer, crew-updater, fetch-resource, operation-store) plus
   `routes/marketplace-company.ts`. This plan extends the same dispatch. Execution is
   gated on that work reaching `integration/connectors-marketplace`.
2. **Two-repo coordination.** The `aoa-marketplace-cdn` schema bump must land before AoA
   ships entries that depend on it. AoA-side code must handle the fields being absent
   (Decision #96).
3. **Curation is real, recurring work.** ~20–40 entries must actually be vetted — package
   pinned, behaviour reviewed. If they are marked `verified` without that review, the
   trust tier is a label and the design degrades to "no gate at all".
4. **Registry availability and schema drift.** A third-party service; its response shape
   can change. Normalisation is the isolation layer.

---

## 8. Out of scope

- **Bulk registry import** — rejected in §3.2.
- **OAuth-brokered connectors** — Plan 4 (Better Auth `genericOAuth`), though the
  `needs_credentials` state is deliberately the shape OAuth will need.
- **Flagship UI-rich plugins** (Slack/Discord/Telegram) — Plan 4.
- **Server-side marketplace search/pagination for all item types** — a real constraint
  (§3.2) but a separate initiative; recorded as FU-9.
