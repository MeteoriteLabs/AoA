# W10B — the DE-08 egress-enforcement probe: THE RESULT

**Run:** [`34085130892`](https://github.com/MeteoriteLabs/AoA/actions/runs/34085130892) · job `probe`, 1m33s
**Date:** 2026-09-07 · **Branch:** `docs/replatform-program` · **Commit:** `ab23eabdc`
**Template:** `aoa-base` (resolved from an empty input) · **Run nonce:** `W10B-MTQRVDJP-2FEX4EOA`
**Verdict:** `DISPOSITION: measured` · `DECISION: abandon (denyout-is-inert-at-this-tier)`

> **Why this file exists.** The `w10b-egress-enforcement-record` artefact is retained for **90 days**;
> this ticket record is not time-limited. `W10B-egress-enforcement-runbook.md` §6 requires the record to
> be copied here after a run, naming the run id, because a keyed lane that fires and is not written down
> is the `E7-F025` failure — *fired and unrecorded* — and the next session re-asks the question.
>
> **This is a record, not an analysis.** The analysis is finding **`E8-F008`**; the candidate-layer census
> it closes is **`E8-F003`** §8; the premise question it settles is **`E8-F007`** §7; the operator context
> is the runbook, §12. **Nothing here proposes or builds any enforcement.**

---

## The answer in one line

The E2B tier behind this repository's `E2B_API_KEY` **accepts** a `network.denyOut` set, **validates** it
server-side, **stores** it, **reads it back verbatim** through `getInfo()` — and **routes the denied
traffic anyway**, through both `Sandbox.create` and `updateNetwork`.

**The ABANDON condition (question **c**) did NOT fire**, so this is genuine inertness and not a
misconfiguration that broke its own experiment: the guest's resolver (`8.8.8.8`) was outside every
declared range, name resolution worked under the policy, and the product-regression rows were reached.
All four mandatory controls held.

---

## The report, verbatim from the run

```
========== W10B DE-08 EGRESS-ENFORCEMENT PROBE — RESULT ==========
TEMPLATE: aoa-base   (default-product-image)
  no template was supplied, so the pack resolved to "aoa-base" — the image AoA production runs, built FROM node:22 with curl and python3 installed. It does NOT fall back to "base": that image has no raw-socket tool, so question (e) would be inconclusive for want of a tool rather than an answer.
DENY SET (policy arm): 169.254.0.0/16, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
ANTI-VACUITY SET     : 198.51.100.0/24
commit: ab23eabdc0504b05156829207940be80d3ec5bd4   run nonce: W10B-MTQRVDJP-2FEX4EOA

Questions:
  a  HONOURED?   is a target inside the declared deny set actually unreachable?
  b  VERIFIABLE? does getInfo() materialize the policy back?
  c  ★ ABANDON?  is the guest's DNS resolver inside the deny set?
  d  RE-ASSERT?  does updateNetwork work on a reused sandbox?
  e  WHERE?      packet path, or an L7 proxy the guest can route around?

PROBE a: NO — denied-target-still-reachable
    169.254.169.254 was REACHED (401) from inside the sandbox that declared 169.254.0.0/16 in denyOut, exactly as from the anti-vacuity arm. The declared deny set is INERT at this tier — the same result the metadata.egressAllowlist seam already produced (E8-F003), one API surface over. That closes the provider-network option and it is a RESULT, not a failure. IPv6 spellings of the SAME destination under the same policy: metadata_v4_mapped=reached/reached metadata_v4_mapped_hex=reached/reached metadata_v6=blocked/refused-or-unrouted. ★ 2 of them REACHED — an IPv4-only deny set has an open IPv6 flank, which is expected: the SDK's only sentinel is ALL_TRAFFIC = 0.0.0.0/0, with no ::/0.
PROBE b: YES — policy-materialized-exactly
    getInfo() returned denyOut = [10.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16], exactly the declared set. A run CAN verify what was applied instead of assuming it.
PROBE c: NO — resolver-outside-the-deny-set
    The approach SURVIVES this question. 8.8.8.8: no declared IPv4 deny entry contains it. nameservers: 8.8.8.8; deny set: 169.254.0.0/16, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16. Name resolution also worked under the policy, so the deny set does not sit between the guest and its resolver.
PROBE d: NO — update-did-not-take-effect
    updateNetwork returned successfully and the target was still REACHED afterwards (401). A reused lease CANNOT be re-policed through this call, so any design that re-asserts policy on reuse is unavailable. The sandbox was paused and resumed before the update, so this is the warm-resume shape.
PROBE e: NO — nothing-was-blocked-so-there-is-no-layer-to-locate
    question (a) measured the deny set INERT: the target was reached under the policy. There is no enforcement anywhere, so asking which layer holds it is dissolved rather than unanswered.
PROBE regression: NO — the-deny-set-does-not-break-the-product
    every exercised product-regression row was REACHED under the deny set: dns_dependent=reached/reached model_api=reached/reached. NOT EXERCISED: aoa_api_url — this check is PARTIAL.

OBSERVATIONS: {"aoaApiRow":"no AOA control-plane URL was supplied; that product-regression row was NOT exercised","denySetV4":["169.254.0.0/16","10.0.0.0/8","172.16.0.0/12","192.168.0.0/16"],"denySetV6":["fe80::/10","fd00::/8","::ffff:0:0/96"],"antiVacuitySet":["198.51.100.0/24"],"controls":{"ok":true,"problems":[]},"policySandboxId":"iqxqyb6z125jm2el8fw11","antiVacuitySandboxId":"ia4rtdajfwq487odec059","getInfoNetwork":{"denyOut":["169.254.0.0/16","10.0.0.0/8","172.16.0.0/12","192.168.0.0/16"],"allowPublicTraffic":true},"resolvConfPolicyArm":"nameserver 8.8.8.8","resolvConfControlArm":"nameserver 8.8.8.8","reuseShape":"warm-resume","reuseShapeDetail":"betaPause() then connect() — the sandbox came back from a pause","ipv6DenyArm":{"created":false,"detail":"SandboxError: 400: invalid denied CIDR ::ffff:0:0/96","readBack":"getInfo failed: not attempted","rows":{},"note":"Whether the API even ACCEPTS IPv6 deny entries is unknown territory: the SDK validates nothing client-side and its only sentinel is ALL_TRAFFIC = 0.0.0.0/0, with no ::/0. A create failure here is a RESULT."}}

DISPOSITION: measured — a=no b=yes c=no d=no e=no regression=no
DECISION   : abandon (denyout-is-inert-at-this-tier)
  The declared deny set had no effect: the target was reached under the policy exactly as without it. The provider-network option is unavailable at this tier for the same reason the metadata.egressAllowlist seam was (E8-F003), one API surface over.
A `no`, and (c)'s ABANDON `yes`, are RESULTS and this lane stays green for them. Only `inconclusive` reds.
=================================================================
```

---

## The durable record, verbatim

`w10b-egress-enforcement-record.json`, schema `aoa.w10b.egress-enforcement-record/1`:

```json
{
  "schema": "aoa.w10b.egress-enforcement-record/1",
  "generatedAt": "2026-09-07T05:01:24.127Z",
  "commitSha": "ab23eabdc0504b05156829207940be80d3ec5bd4",
  "workflowRunUrl": "https://github.com/MeteoriteLabs/AoA/actions/runs/34085130892",
  "runNonce": "W10B-MTQRVDJP-2FEX4EOA",
  "template": {
    "resolved": "aoa-base",
    "source": "default-product-image",
    "note": "no template was supplied, so the pack resolved to \"aoa-base\" — the image AoA production runs, built FROM node:22 with curl and python3 installed. It does NOT fall back to \"base\": that image has no raw-socket tool, so question (e) would be inconclusive for want of a tool rather than an answer."
  },
  "denySet": [
    "169.254.0.0/16",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16"
  ],
  "disposition": {
    "disposition": "measured",
    "exitCode": 0,
    "detail": "a=no b=yes c=no d=no e=no regression=no"
  },
  "decision": {
    "decision": "abandon",
    "because": "denyout-is-inert-at-this-tier",
    "detail": "The declared deny set had no effect: the target was reached under the policy exactly as without it. The provider-network option is unavailable at this tier for the same reason the metadata.egressAllowlist seam was (E8-F003), one API surface over."
  },
  "probes": [
    {
      "probe": "a",
      "state": "no",
      "reason": "denied-target-still-reachable",
      "detail": "169.254.169.254 was REACHED (401) from inside the sandbox that declared 169.254.0.0/16 in denyOut, exactly as from the anti-vacuity arm. The declared deny set is INERT at this tier — the same result the metadata.egressAllowlist seam already produced (E8-F003), one API surface over. That closes the provider-network option and it is a RESULT, not a failure. IPv6 spellings of the SAME destination under the same policy: metadata_v4_mapped=reached/reached metadata_v4_mapped_hex=reached/reached metadata_v6=blocked/refused-or-unrouted. ★ 2 of them REACHED — an IPv4-only deny set has an open IPv6 flank, which is expected: the SDK's only sentinel is ALL_TRAFFIC = 0.0.0.0/0, with no ::/0."
    },
    {
      "probe": "b",
      "state": "yes",
      "reason": "policy-materialized-exactly",
      "detail": "getInfo() returned denyOut = [10.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16], exactly the declared set. A run CAN verify what was applied instead of assuming it."
    },
    {
      "probe": "c",
      "state": "no",
      "reason": "resolver-outside-the-deny-set",
      "detail": "The approach SURVIVES this question. 8.8.8.8: no declared IPv4 deny entry contains it. nameservers: 8.8.8.8; deny set: 169.254.0.0/16, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16. Name resolution also worked under the policy, so the deny set does not sit between the guest and its resolver."
    },
    {
      "probe": "d",
      "state": "no",
      "reason": "update-did-not-take-effect",
      "detail": "updateNetwork returned successfully and the target was still REACHED afterwards (401). A reused lease CANNOT be re-policed through this call, so any design that re-asserts policy on reuse is unavailable. The sandbox was paused and resumed before the update, so this is the warm-resume shape."
    },
    {
      "probe": "e",
      "state": "no",
      "reason": "nothing-was-blocked-so-there-is-no-layer-to-locate",
      "detail": "question (a) measured the deny set INERT: the target was reached under the policy. There is no enforcement anywhere, so asking which layer holds it is dissolved rather than unanswered."
    },
    {
      "probe": "regression",
      "state": "no",
      "reason": "the-deny-set-does-not-break-the-product",
      "detail": "every exercised product-regression row was REACHED under the deny set: dns_dependent=reached/reached model_api=reached/reached. NOT EXERCISED: aoa_api_url — this check is PARTIAL."
    }
  ],
  "observations": {
    "aoaApiRow": "no AOA control-plane URL was supplied; that product-regression row was NOT exercised",
    "denySetV4": [
      "169.254.0.0/16",
      "10.0.0.0/8",
      "172.16.0.0/12",
      "192.168.0.0/16"
    ],
    "denySetV6": [
      "fe80::/10",
      "fd00::/8",
      "::ffff:0:0/96"
    ],
    "antiVacuitySet": [
      "198.51.100.0/24"
    ],
    "controls": {
      "ok": true,
      "problems": []
    },
    "policySandboxId": "iqxqyb6z125jm2el8fw11",
    "antiVacuitySandboxId": "ia4rtdajfwq487odec059",
    "getInfoNetwork": {
      "denyOut": [
        "169.254.0.0/16",
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16"
      ],
      "allowPublicTraffic": true
    },
    "resolvConfPolicyArm": "nameserver 8.8.8.8",
    "resolvConfControlArm": "nameserver 8.8.8.8",
    "reuseShape": "warm-resume",
    "reuseShapeDetail": "betaPause() then connect() — the sandbox came back from a pause",
    "ipv6DenyArm": {
      "created": false,
      "detail": "SandboxError: 400: invalid denied CIDR ::ffff:0:0/96",
      "readBack": "getInfo failed: not attempted",
      "rows": {},
      "note": "Whether the API even ACCEPTS IPv6 deny entries is unknown territory: the SDK validates nothing client-side and its only sentinel is ALL_TRAFFIC = 0.0.0.0/0, with no ::/0. A create failure here is a RESULT."
    }
  }
}
```

---

## Raw rows worth keeping, read from the step log

These are not in the summary block and are the evidence behind three claims in `E8-F008`.

| arm | row | raw |
|---|---|---|
| policy | `allowed_public` | `exit 0 / 200` — the POSITIVE control |
| policy | `unresolvable` | `curl (6) Could not resolve host` — the APPARATUS control |
| policy | `metadata_v4` | `exit 0 / 401` — **the question target, REACHED under its own deny range** |
| policy | `metadata_v4_mapped` | `exit 0 / 401` |
| policy | `metadata_v4_mapped_hex` | `exit 0 / 401` |
| policy | `metadata_v6` | `curl (7)` — also failed in the control arm, **unattributable** |
| policy | `rfc1918_10` | `curl (28)` timeout — also timed out in the control arm, **unattributable** |
| policy | `raw_http_bytes` | `connected`, 226 bytes back: `HTTP/1.0 401 … Server: Firecracker API` |
| anti-vacuity | `metadata_v4` | `exit 0 / 401` — the ANTI-VACUITY control |
| anti-vacuity | `allowed_public` / `unresolvable` | `200` / `curl (6)` |
| reuse | `metadata_v4` before / after `updateNetwork` | `401` / `401`, across a `betaPause()` + `connect()` warm resume |
| IPv6 arm | `Sandbox.create` | **`SandboxError: 400: invalid denied CIDR ::ffff:0:0/96`** — the arm was never created |

**Sandbox ids:** policy `iqxqyb6z125jm2el8fw11` · anti-vacuity `ia4rtdajfwq487odec059` · reuse
`i7y52on39wdczxyhrm94v` · IPv6 arm not created.

---

## What was NOT exercised

- **`aoa_api_url`** — the push route carries no workflow inputs, so the AoA control-plane
  product-regression row was skipped and the regression verdict reports itself **PARTIAL**. The record
  names the row.
- **`allowOut`** and **`allowInternetAccess: false`** — this run measured `denyOut`. Reasoning from this
  result to those fields is an argument, not a measurement.
- **Any tier other than the one this repository's `E2B_API_KEY` reaches.** `resolveE2bDomain` makes the
  API target per-company configurable.
