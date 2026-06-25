# @armyofagents/cli

## 1.0.1

### Patch Changes

- adc7c55: fix(security): close cross-tenant IDOR on /approvals/:id/approve|reject|request-revision (C3) and remove the spoofable `decidedByUserId` body field (C4). Decider is now derived from `req.actor.userId` server-side; CLI no longer accepts `--decided-by-user-id`.
- Updated dependencies [f11ee90]
- Updated dependencies [a35f59a]
- Updated dependencies [68d604d]
- Updated dependencies [e1a6cd3]
- Updated dependencies [0a6f335]
- Updated dependencies [adc7c55]
- Updated dependencies [e6b55aa]
- Updated dependencies [e499937]
- Updated dependencies [58ef0bd]
- Updated dependencies [1f11d51]
- Updated dependencies [371dccb]
- Updated dependencies [4d614c0]
- Updated dependencies [0636a9c]
- Updated dependencies [b409caf]
- Updated dependencies [aff48f4]
- Updated dependencies [b11756a]
- Updated dependencies [8866f90]
- Updated dependencies [a1f61c2]
- Updated dependencies [f6ad056]
- Updated dependencies [74ac332]
- Updated dependencies [7c8955e]
- Updated dependencies [341c6ac]
- Updated dependencies [9ca1dcb]
- Updated dependencies [a94df0d]
- Updated dependencies [44fbf74]
- Updated dependencies [62ebfd5]
- Updated dependencies [608d87d]
  - @armyofagents/db@1.0.1
  - @armyofagents/server@1.0.1
  - @armyofagents/shared@1.0.1
  - @armyofagents/adapter-utils@1.0.1
  - @armyofagents/adapter-claude-local@1.0.1
  - @armyofagents/adapter-codex-local@1.0.1
  - @armyofagents/adapter-cursor-local@1.0.1
  - @armyofagents/adapter-gemini-local@1.0.1
  - @armyofagents/adapter-openclaw@1.0.1
  - @armyofagents/adapter-opencode-local@1.0.1

> Historical entries below reference this CLI's prior package name `paperclipai` and the legacy `@paperclipai/*` workspace scope. The CLI is now published as `@armyofagents/cli`; the `paperclipai` bin alias is preserved for backward compatibility (see root `package.json`). Entries authored under the legacy names are kept verbatim as a release record.

## 0.2.7

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @paperclipai/shared@0.2.7
  - @paperclipai/adapter-utils@0.2.7
  - @paperclipai/db@0.2.7
  - @paperclipai/adapter-claude-local@0.2.7
  - @paperclipai/adapter-codex-local@0.2.7
  - @paperclipai/adapter-openclaw@0.2.7
  - @paperclipai/server@0.2.7

## 0.2.6

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @paperclipai/shared@0.2.6
  - @paperclipai/adapter-utils@0.2.6
  - @paperclipai/db@0.2.6
  - @paperclipai/adapter-claude-local@0.2.6
  - @paperclipai/adapter-codex-local@0.2.6
  - @paperclipai/adapter-openclaw@0.2.6
  - @paperclipai/server@0.2.6

## 0.2.5

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @paperclipai/shared@0.2.5
  - @paperclipai/adapter-utils@0.2.5
  - @paperclipai/db@0.2.5
  - @paperclipai/adapter-claude-local@0.2.5
  - @paperclipai/adapter-codex-local@0.2.5
  - @paperclipai/adapter-openclaw@0.2.5
  - @paperclipai/server@0.2.5

## 0.2.4

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @paperclipai/shared@0.2.4
  - @paperclipai/adapter-utils@0.2.4
  - @paperclipai/db@0.2.4
  - @paperclipai/adapter-claude-local@0.2.4
  - @paperclipai/adapter-codex-local@0.2.4
  - @paperclipai/adapter-openclaw@0.2.4
  - @paperclipai/server@0.2.4

## 0.2.3

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @paperclipai/shared@0.2.3
  - @paperclipai/adapter-utils@0.2.3
  - @paperclipai/db@0.2.3
  - @paperclipai/adapter-claude-local@0.2.3
  - @paperclipai/adapter-codex-local@0.2.3
  - @paperclipai/adapter-openclaw@0.2.3
  - @paperclipai/server@0.2.3

## 0.2.2

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @paperclipai/shared@0.2.2
  - @paperclipai/adapter-utils@0.2.2
  - @paperclipai/db@0.2.2
  - @paperclipai/adapter-claude-local@0.2.2
  - @paperclipai/adapter-codex-local@0.2.2
  - @paperclipai/adapter-openclaw@0.2.2
  - @paperclipai/server@0.2.2

## 0.2.1

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @paperclipai/shared@0.2.1
  - @paperclipai/adapter-utils@0.2.1
  - @paperclipai/db@0.2.1
  - @paperclipai/adapter-claude-local@0.2.1
  - @paperclipai/adapter-codex-local@0.2.1
  - @paperclipai/adapter-openclaw@0.2.1
  - @paperclipai/server@0.2.1
