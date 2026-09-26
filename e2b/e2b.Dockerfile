# AoA cloud-execution-isolation sandbox template ("aoa-base").
#
# The default E2B `base` template is bare, so the CLIs AoA runs inside the
# sandbox (`claude`, `codex`) are not present — a run/probe fails with
# `env: 'claude': No such file or directory`. This template pre-installs them so
# every sandboxed run (org/crew agents, readiness probes, discussion/file-import
# extraction, Commander compaction) starts with the CLIs already on PATH — no
# per-run `npm install -g`, so sandboxes are fast.
#
# Build + register on your E2B account, then set E2B_TEMPLATE=aoa-base on the
# instance (see e2b/README.md). Debian-based (node:22) → E2B-compatible; E2B
# injects its own envd on top.
FROM node:22

# Tooling the agent CLIs + software-development workspaces need. ripgrep is used
# by claude-code; git/curl/ca-certificates for repo + network ops; python3 +
# build-essential for native deps and software-dev agents.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      curl \
      ca-certificates \
      ripgrep \
      python3 \
      python3-pip \
      build-essential \
    && rm -rf /var/lib/apt/lists/*

# The EXACT packages the AoA adapters install at spawn on the bare template
# (server/src/adapters/registry.ts → SANDBOX_INSTALL_COMMAND):
#   claude_local: npm install -g @anthropic-ai/claude-code   (command: claude)
#   codex_local:  npm install -g @openai/codex               (command: codex)
# ★★★ THE CLAUDE CLI IS PINNED, AND THE PIN IS EVIDENCE, NOT HYGIENE.
# Ruling F7 (`docs/replatform/epics/E7-coding-e2b/decisions.md`, `E7-D11`) chose a LOCATION-BASED
# output mechanism — a conventional output root — and it rests on ONE measurement: the P-011 probe's
# `A-neg` arm, run `35833717162`, which observed that a no-op `claude --print` writes NOTHING under
# that root (decision row R6). The probe recorded the binary it measured:
# `claude 2.1.251 (Claude Code)` at `/usr/local/bin/claude`, identical on all four model arms.
#
# Unpinned, this line was `npm install -g @anthropic-ai/claude-code @openai/codex`, so a template
# REBUILD could pick up a release whose session/state handling writes into the run's working
# directory — silently falsifying R6 while every other check, including the `S-P0` template-empty
# arm, still passed. The measurement the ruling rests on would stop being true with nothing red.
#
# So the version is pinned to the one the ruling was measured against. CHANGING IT RE-OPENS THAT
# MEASUREMENT: bump it only together with an `A-neg` re-run on the rebuilt template, and record the
# new version and run id in `E7-D11`. Codex stays unpinned deliberately — `E7-D04` excludes
# `codex_local` from the output mechanism, so no ruling depends on its behaviour.
#
# ★ SCOPE OF THE PIN, STATED SO IT IS NOT OVER-READ. This pins the IMAGE. The spawn-time path is
# `SANDBOX_INSTALL_COMMAND` (`packages/adapters/claude-local/src/index.ts`), still unpinned, delivered
# by `buildNpmGlobalInstallIfMissingCommand` (`packages/adapter-utils/src/sandbox-install.ts`) as
# `if ! command -v claude …; then npm install -g …; fi` — INSTALL-IF-MISSING. On this image `claude`
# is present, so that branch does not fire and the pinned version is what runs. On a BARE template it
# does fire and installs latest, unpinned. That is why `E7-D11`'s precondition is per-TEMPLATE: the
# pin removes accidental drift on this image, and the `A-neg` re-run covers every other case.
RUN npm install -g @anthropic-ai/claude-code@2.1.251 @openai/codex

# BRW-003b — Playwright + Chromium for browser-session workloads.
#
# ★ WITHOUT THIS THE BROWSER RUNTIME CANNOT START A BROWSER IN THE DEPLOYMENT TARGET.
# BRW-002's browser clauses are green in CI because the GitHub runner installs Chromium
# (`playwright install --with-deps chromium` in the `browser` job). This image had neither
# Playwright nor Chromium, so every clause proven in CI said nothing about a real sandbox.
# The gap was invisible precisely because the build guard below asserted `claude`/`codex`
# and nothing else — the shape of assertion that would have caught it, absent for the one
# thing it did not cover.
#
# Installed GLOBALLY with NODE_PATH set, because the runner is STAGED, not installed: the
# host does `writeFiles(runner + session.json)` then `exec(node runner.js session.json)`,
# so the guest has no node_modules of its own to resolve `import { chromium } from
# "playwright"` against.
RUN npm install -g playwright@1.59.1 \
 && npx --yes playwright@1.59.1 install --with-deps chromium
ENV NODE_PATH=/usr/local/lib/node_modules

# Fail the build if either CLI is not resolvable — the whole point of the
# template. AoA's detectCommand is `command -v claude` / `command -v codex`.
RUN command -v claude && command -v codex && claude --version && codex --version

# ★ The same shape of assertion, for the thing whose absence went unnoticed: prove the
# runtime can BOTH resolve the module and find a real browser binary on disk. `require`
# alone would pass with no browser installed; an executablePath() string alone would pass
# without the file existing. Both, or the build fails.
RUN node -e "const {chromium}=require('playwright'); const p=chromium.executablePath(); require('fs').accessSync(p); console.log('chromium OK:', p);"

