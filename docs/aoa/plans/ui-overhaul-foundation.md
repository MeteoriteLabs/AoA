# UI Overhaul · Foundation + Lobby Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use **superpowers:subagent-driven-development** for Phase 1 tasks (foundation — fresh subagent per task with two-stage review). Phase 2 tasks (Lobby pilot) execute inline since the user reviews per-page work directly. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plan date:** 2026-05-07
**Branch:** `feat/ui-overhaul`
**Worktree:** `.worktrees/ui-overhaul/`
**Spec source of truth:** [`docs/aoa/design/design-system.md`](../design/design-system.md) — when in doubt, that doc wins.

---

**Goal:** Apply the locked design system to the AoA codebase. Phase 1 updates global tokens + shadcn primitives so every page automatically inherits the new visual baseline. Phase 2 pilots the new layout patterns (page header, gradient placement, etc.) on the Lobby to validate the foundation before tackling more complex pages.

**Architecture:** Tokens live in `ui/src/index.css` Tailwind v4 `@theme inline` block. Existing shadcn-style primitives in `ui/src/components/ui/` consume these tokens. Phase 1 updates tokens + restyles primitives. Phase 2 applies new layout patterns to existing Lobby pages. No backend changes anywhere in this plan.

**Tech Stack:** React 18 · Vite · Tailwind CSS v4 · shadcn/ui · TypeScript · pnpm workspaces.

---

## Architecture decisions made in this plan

1. **Token strategy:** add new brand-specific tokens (`--brand`, `--brand-hover`, `--data-teal`, etc.) as the canonical design-system tokens. Remap existing shadcn tokens (`--primary`, `--destructive`, `--ring`, etc.) to reference them. This way: (a) shadcn primitives that use `--primary` automatically get brand red, (b) we have explicit brand-named tokens for new components, (c) shadcn defaults can be overridden cleanly.

2. **No backwards-compat layer.** Lobby PRs #162–#164 already shipped with prior visuals on `main`. We're replacing them with the new system end-to-end. No feature flag, no AB.

3. **Light + dark mode parity.** Every token gets both `.dark` and `:root` (light) values. Components must work in both without conditional code.

4. **Phase 1 = ZERO layout changes.** Tokens + primitive styles only. Pages that already use `Button`, `Dialog`, etc. visually shift but functionally stay identical. This minimizes regressions and lets us validate the foundation independently.

5. **Phase 2 = Lobby pilot only.** Other pages stay on old layouts until their own per-page phase. This protects against scope creep.

6. **Verification = type-check + lint + unit tests + visual check + e2e smoke.** No dedicated visual-regression tests in this codebase yet; manual visual review per task is the gate. See **Test strategy** section below for the explicit checks.

7. **Test strategy is layered.** Per-task: TS type-check + lint always. Per new-component task: basic vitest unit test added alongside the component (renders, variants, className passthrough). Per modified-component task: confirm existing vitest tests that consume the component still pass. Plus two **verification gates** that run the full vitest suite + a fast subset of e2e specs — one after primitive restyling (between Tasks 11 and 12), one after new-primitive creation (between Tasks 22 and 23). Catches regressions early instead of accumulating across 22 commits.

---

## Test strategy

### Per-task (always)

```bash
pnpm --filter ui typecheck   # always
pnpm --filter ui lint        # always
```

### For tasks creating NEW components (Tasks 12, 16, 17, 18, 19, 20, 21, 22)

The implementer must additionally create a vitest test file at `ui/src/components/ui/__tests__/<component>.test.tsx` covering:
1. Renders without crashing (with minimal required props)
2. Accepts each declared variant / size prop and applies the expected class
3. Custom `className` prop passes through (merged, not replaced)
4. Exports match what the spec advertises

Then run `pnpm --filter ui test:run -- <component>` and confirm it passes. Include the test file in the same commit as the component.

Example (StatusDot):

```tsx
import { render } from "@testing-library/react";
import { StatusDot } from "../status-dot";

describe("StatusDot", () => {
  it("renders with default variant", () => {
    const { container } = render(<StatusDot />);
    const el = container.querySelector("span");
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass("rounded-full");
  });
  it("live variant applies pulse animation class", () => {
    const { container } = render(<StatusDot variant="live" />);
    expect(container.querySelector("span")?.className).toContain("animate-pulse-glow");
  });
  it("custom className merges through", () => {
    const { container } = render(<StatusDot className="custom" />);
    expect(container.querySelector("span")).toHaveClass("custom");
  });
});
```

Same pattern for: Switch, RadioGroup, Avatar (the restyle), MetaPill, EmptyState, Stepper (3 variants — test each), SectionHeader, PageHeader, SecondarySidebar (test collapsed state, active item, count badges), Toaster (mostly a wrapper — minimal test).

### For tasks modifying EXISTING components (Tasks 2–11, 13, 14, 15)

Before committing, find which existing tests reference the component and confirm they still pass:

```bash
grep -rln "from.*\\(button\\|dialog\\|sheet\\|popover\\|tabs\\|tooltip\\|badge\\|input\\|textarea\\|label\\|checkbox\\|select\\|avatar\\|skeleton\\|breadcrumb\\)" ui/src --include="*.test.tsx"
pnpm --filter ui test:run
```

If a test fails because the component's API changed, update the test (don't revert the component). If a test fails because behavior actually broke, fix the component.

### Verification gates

**Gate A** (after Task 11, before Task 12): primitive restyling complete.
```bash
pnpm --filter ui test:run                                          # full vitest
pnpm test:e2e -- onboarding sign-out-flow keyboard-cheatsheet      # 3 fast specs
```
Stop and fix before proceeding if anything fails.

**Gate B** (after Task 22, before Task 23): new primitives complete.
```bash
pnpm --filter ui test:run
pnpm test:e2e -- onboarding sign-out-flow keyboard-cheatsheet
```
Stop and fix before proceeding.

**Final smoke** (Task 23): walks every major page + runs full e2e suite.

---

## File Structure

### Files to MODIFY in Phase 1

```
ui/src/index.css                                   # Token expansion
ui/src/components/ui/button.tsx                    # 6 variants × 3 sizes
ui/src/components/ui/dialog.tsx                    # Modal pattern (polished)
ui/src/components/ui/alert-dialog.tsx              # Modal pattern (destructive variant)
ui/src/components/ui/sheet.tsx                     # Sheet pattern (polished)
ui/src/components/ui/popover.tsx                   # Popover pattern
ui/src/components/ui/dropdown-menu.tsx             # Inherits popover style
ui/src/components/ui/tabs.tsx                      # Sliding underline
ui/src/components/ui/tooltip.tsx                   # Frosted glass
ui/src/components/ui/badge.tsx                     # Gradient + glow + live pulse
ui/src/components/ui/input.tsx                     # Focus ring, height
ui/src/components/ui/textarea.tsx                  # Same focus pattern
ui/src/components/ui/label.tsx                     # Font weight, size
ui/src/components/ui/checkbox.tsx                  # Brand red checked state
ui/src/components/ui/select.tsx                    # Custom arrow, focus
ui/src/components/ui/avatar.tsx                    # Initials + dept colors
ui/src/components/ui/breadcrumb.tsx                # Spec anatomy
ui/src/components/ui/skeleton.tsx                  # Gradient sweep
ui/src/components/ui/confirm-dialog.tsx            # Inherits new dialog
```

### Files to CREATE in Phase 1

```
ui/src/components/ui/switch.tsx                    # Missing primitive (32×18 brand red)
ui/src/components/ui/radio-group.tsx               # Missing primitive
ui/src/components/ui/toaster.tsx                   # Toast with sonner OR custom
ui/src/components/ui/status-dot.tsx                # NEW: live/active/idle indicator
ui/src/components/ui/meta-pill.tsx                 # NEW: header meta-pill row
ui/src/components/ui/stepper.tsx                   # NEW: 3 variants (horizontal, vertical, dots)
ui/src/components/ui/empty-state.tsx               # NEW: icon + title + sub + CTA composite
ui/src/components/ui/loading-skeleton.tsx          # NEW: helpers for common skeleton shapes
ui/src/components/ui/section-header.tsx            # NEW: form section header (small-caps + numeric badge)
ui/src/components/PageHeader.tsx                   # NEW: page-level breadcrumb+title+actions composite
ui/src/components/SecondarySidebar.tsx             # NEW: page-scoped collapsible sidebar
```

### Files to MODIFY in Phase 2 (Lobby pilot only)

```
ui/src/components/LobbySidebar.tsx                 # Apply tokens
ui/src/pages/Lobby.tsx (or wherever lobby renders) # Apply page-header anatomy + radial wash
ui/src/components/lobby/*.tsx                      # Any subcomponents using old visual
```

---

# Phase 1 — Foundation

> Each Phase 1 task is **subagent-driven**: dispatch a fresh subagent with the task text + relevant spec section + file paths. Two-stage review (spec compliance, then code quality) before marking complete.

---

## Task 1: Update CSS tokens in `ui/src/index.css`

**Files:**
- Modify: `ui/src/index.css`

**Spec reference:** [§2 Color system](../design/design-system.md#2-color-system), [§4 Spacing](../design/design-system.md#4-spacing--sizing), [§5 Border & radius](../design/design-system.md#5-border--radius), [§6 Elevation](../design/design-system.md#6-elevation--shadows), [§7 Motion](../design/design-system.md#7-motion).

**Steps:**

- [ ] **Step 1:** Read current `ui/src/index.css` to understand the existing `@theme inline` block and `:root` / `.dark` variable definitions. Note all variables that other primitives reference.

- [ ] **Step 2:** Add new brand tokens at the top of the `@theme inline` block. Add new neutral surface tiers, data palette, motion, radius scale, shadow tokens. Replace this block:

```css
@theme inline {
  /* === Brand === */
  --color-brand: var(--brand);
  --color-brand-hover: var(--brand-hover);
  --color-brand-tint-08: var(--brand-tint-08);
  --color-brand-tint-15: var(--brand-tint-15);

  /* === Semantic states === */
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-error: var(--error);
  --color-info: var(--info);

  /* === Data palette === */
  --color-data-teal: var(--data-teal);
  --color-data-indigo: var(--data-indigo);
  --color-data-green: var(--data-green);
  --color-data-amber: var(--data-amber);
  --color-data-magenta: var(--data-magenta);
  --color-data-slate: var(--data-slate);

  /* === Surfaces === */
  --color-bg: var(--bg);
  --color-card: var(--card);
  --color-card-2: var(--card-2);
  --color-hd: var(--hd);
  --color-field: var(--field);
  --color-text: var(--text);
  --color-dim: var(--dim);
  --color-very-dim: var(--very-dim);
  --color-border: var(--border);
  --color-border-soft: var(--border-soft);
  --color-border-strong: var(--border-strong);

  /* === Existing shadcn tokens — remapped === */
  --color-background: var(--bg);
  --color-foreground: var(--text);
  --color-card-foreground: var(--text);
  --color-popover: var(--card-2);
  --color-popover-foreground: var(--text);
  --color-primary: var(--brand);
  --color-primary-foreground: white;
  --color-secondary: var(--card);
  --color-secondary-foreground: var(--text);
  --color-muted: var(--card);
  --color-muted-foreground: var(--dim);
  --color-accent: var(--card);
  --color-accent-foreground: var(--text);
  --color-destructive: var(--error);
  --color-destructive-foreground: white;
  --color-input: var(--field);
  --color-ring: var(--brand);

  /* === Radius === */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;
  --radius-2xl: 16px;
  --radius-full: 999px;
  --radius: 6px;

  /* === Spacing — Tailwind defaults already give us 4px base === */

  /* === Motion === */
  --animate-shimmer: shimmer 1.6s linear infinite;
  --animate-pulse-glow: pulse-glow 1.5s ease-in-out infinite;
  --animate-float-gentle: float-gentle 3.5s ease-in-out infinite;
}

@keyframes shimmer {
  0% { background-position: -120% 0; }
  100% { background-position: 220% 0; }
}

@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(184, 45, 28, 0.6), 0 0 6px rgba(184, 45, 28, 0.4); }
  50% { box-shadow: 0 0 0 5px rgba(184, 45, 28, 0), 0 0 12px rgba(184, 45, 28, 0.6); }
}

@keyframes float-gentle {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}
```

- [ ] **Step 3:** Replace the `:root` (light mode) variable values with the new design system colors:

```css
:root {
  color-scheme: light;

  /* Brand */
  --brand: #921a0d;
  --brand-hover: #b32616;
  --brand-tint-08: rgba(146, 26, 13, 0.06);
  --brand-tint-15: rgba(146, 26, 13, 0.12);

  /* Semantic */
  --success: #0a8a4f;
  --warning: #a87a1c;
  --error: #ef4444;
  --info: #2563eb;

  /* Data palette (same hex on both modes) */
  --data-teal: #3FA8C7;
  --data-indigo: #6470DC;
  --data-green: #4FB67E;
  --data-amber: #D9A938;
  --data-magenta: #C25BA8;
  --data-slate: #7E8AA8;

  /* Surfaces (light) */
  --bg: oklch(0.99 0.005 30);
  --card: oklch(0.97 0.005 30);
  --card-2: oklch(0.95 0.005 30);
  --hd: oklch(0.94 0.005 30);
  --field: white;
  --text: hsl(20 12% 18%);
  --dim: hsl(20 8% 40%);
  --very-dim: hsl(20 8% 55%);
  --border: hsl(20 8% 88%);
  --border-soft: hsl(20 8% 92%);
  --border-strong: hsl(20 8% 78%);

  /* Charts (entity-task / agent / brief / goal / memory — keep entity-* but remap chart-1..5) */
  --chart-1: var(--data-indigo);
  --chart-2: var(--data-teal);
  --chart-3: var(--data-amber);
  --chart-4: var(--data-magenta);
  --chart-5: var(--data-green);

  /* Sidebar (existing shadcn — remap to new tokens) */
  --sidebar: var(--card);
  --sidebar-foreground: var(--text);
  --sidebar-primary: var(--brand);
  --sidebar-primary-foreground: white;
  --sidebar-accent: var(--hd);
  --sidebar-accent-foreground: var(--text);
  --sidebar-border: var(--border);
  --sidebar-ring: var(--brand);

  --radius: 6px;

  /* Entity-specific (preserve existing — used by old code) */
  --entity-task: var(--data-indigo);
  --entity-agent: var(--data-green);
  --entity-brief: var(--data-magenta);
  --entity-goal: var(--data-amber);
  --entity-memory: var(--data-slate);
}
```

- [ ] **Step 4:** Replace the `.dark` block with new dark-mode values:

```css
.dark {
  /* Brand */
  --brand: #b82d1c;
  --brand-hover: #d13a26;
  --brand-tint-08: rgba(184, 45, 28, 0.08);
  --brand-tint-15: rgba(184, 45, 28, 0.15);

  /* Semantic */
  --success: #4FB67E;
  --warning: #D9A938;
  --error: #ef4444;
  --info: #3b82f6;

  /* Data palette (same as light) */
  --data-teal: #3FA8C7;
  --data-indigo: #6470DC;
  --data-green: #4FB67E;
  --data-amber: #D9A938;
  --data-magenta: #C25BA8;
  --data-slate: #7E8AA8;

  /* Surfaces (dark) */
  --bg: #0a0a0a;
  --card: oklch(0.19 0.005 30);
  --card-2: oklch(0.205 0.005 30);
  --hd: oklch(0.16 0.005 30);
  --field: oklch(0.13 0.005 30);
  --text: #eeeeee;
  --dim: hsl(0 0% 60%);
  --very-dim: hsl(0 0% 45%);
  --border: hsl(0 0% 14%);
  --border-soft: hsl(0 0% 11%);
  --border-strong: hsl(0 0% 22%);

  /* Charts */
  --chart-1: var(--data-indigo);
  --chart-2: var(--data-teal);
  --chart-3: var(--data-amber);
  --chart-4: var(--data-magenta);
  --chart-5: var(--data-green);

  /* Sidebar */
  --sidebar: var(--card);
  --sidebar-foreground: var(--text);
  --sidebar-primary: var(--brand);
  --sidebar-primary-foreground: white;
  --sidebar-accent: var(--hd);
  --sidebar-accent-foreground: var(--text);
  --sidebar-border: var(--border);
  --sidebar-ring: var(--brand);

  /* Entity */
  --entity-task: var(--data-indigo);
  --entity-agent: var(--data-green);
  --entity-brief: var(--data-magenta);
  --entity-goal: var(--data-amber);
  --entity-memory: var(--data-slate);
}
```

- [ ] **Step 5:** Add Inter and Geist Mono Google Fonts imports at the very top of `ui/src/index.css` (above `@import "tailwindcss"` per Tailwind v4 ordering rules). Update the body/font stack:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap');
@import "tailwindcss";

/* ... */

@theme inline {
  --font-sans: 'Inter', -apple-system, system-ui, sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, monospace;
  /* ... rest of @theme as above */
}

body {
  font-family: var(--font-sans);
  font-feature-settings: 'cv11', 'ss01', 'ss03';
}
```

- [ ] **Step 6:** Type-check and run dev server to verify nothing breaks:

```bash
pnpm --filter ui typecheck
pnpm --filter ui build
```

Expected: clean type-check + clean build. Visual will be wrong on most pages until later tasks restyle the primitives, but TS + build must pass.

- [ ] **Step 7:** Commit.

```bash
git add ui/src/index.css
git commit -m "feat(ui): add design-system tokens to index.css

Adds brand/semantic/data/surface/motion/radius tokens per
docs/aoa/design/design-system.md. Remaps existing shadcn tokens
(--primary, --destructive, --ring, etc.) to new brand tokens so
existing primitives inherit brand red automatically.

Loads Inter + Geist Mono from Google Fonts. Light + dark mode
parity. Visual will look wrong on pages until primitives are
restyled in later tasks; this commit only adds the token layer."
```

---

## Task 2: Restyle `Button` primitive

**Files:**
- Modify: `ui/src/components/ui/button.tsx`

**Spec reference:** [§9.1 Buttons](../design/design-system.md#91-buttons).

**Steps:**

- [ ] **Step 1:** Read `ui/src/components/ui/button.tsx` to understand current variants and class structure (uses `cva` from class-variance-authority).

- [ ] **Step 2:** Replace the `buttonVariants` cva with the new variant definitions:

```ts
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-tint-15 focus-visible:border-brand disabled:opacity-40 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-brand text-white hover:bg-brand-hover border border-transparent",
        secondary: "bg-card text-text border border-border hover:bg-hd",
        outline: "bg-transparent text-text border border-border-strong hover:bg-card",
        ghost: "bg-transparent text-text border border-transparent hover:bg-white/5",
        destructive: "bg-error text-white hover:bg-[#f87171] border border-transparent",
        link: "bg-transparent text-brand hover:text-brand-hover hover:underline border-0 p-0 h-auto font-semibold",
      },
      size: {
        sm: "h-[26px] px-2.5 text-xs rounded-[5px] [&_svg]:size-3.5",
        default: "h-8 px-3 text-sm rounded-md [&_svg]:size-4",
        lg: "h-10 px-4 text-base rounded-lg [&_svg]:size-4",
        icon: "size-8 p-0 rounded-md [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);
```

- [ ] **Step 3:** Type-check.

```bash
pnpm --filter ui typecheck
```

Expected: pass. The `Button` component's TS interface is unchanged.

- [ ] **Step 4:** Visual verify: run dev server (`pnpm dev`), open `http://localhost:3100/`, click around to surfaces with buttons (Lobby, any modal). Confirm primary buttons are brand red, ghost/outline buttons render correctly, disabled state at 40% opacity, hover transitions smooth.

- [ ] **Step 5:** Commit.

```bash
git add ui/src/components/ui/button.tsx
git commit -m "feat(ui): restyle Button to design-system spec

6 variants (default/secondary/outline/ghost/destructive/link)
× 3 sizes (sm/md/lg) + icon. Maps to new brand tokens. Focus
ring is 3px brand-tinted glow + brand border. Disabled state
40% opacity per spec §9.1."
```

---

## Task 3: Restyle `Dialog` (modal pattern)

**Files:**
- Modify: `ui/src/components/ui/dialog.tsx`

**Spec reference:** [§9.3 Modals](../design/design-system.md#93-modals).

**Steps:**

- [ ] **Step 1:** Read current `dialog.tsx`. Identify the `DialogOverlay`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter` exports.

- [ ] **Step 2:** Update class names to apply the polished pattern:

- `DialogOverlay`: `bg-black/55 backdrop-blur-sm`
- `DialogContent`: `bg-card border border-border rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.5),0_32px_80px_rgba(0,0,0,0.5),0_0_60px_rgba(184,45,28,0.05)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-top-2 duration-160 ease-out`
- `DialogHeader`: add `relative` + the radial wash background:
  - `className="px-7 pt-7 pb-5 relative bg-[radial-gradient(ellipse_90%_60%_at_50%_-20%,rgba(239,68,68,0.08)_0%,transparent_70%)]"` (destructive)
  - For non-destructive, drop the wash: `className="px-7 pt-7 pb-5 relative"`
- `DialogTitle`: `text-[1.15rem] font-bold tracking-[-0.018em] mb-2`
- `DialogDescription`: `text-[0.85rem] text-dim leading-[1.55]`
- `DialogFooter`: `px-7 py-3.5 border-t border-border bg-gradient-to-b from-hd to-card flex gap-2 justify-end`
- Add a close `X` button absolutely positioned top-right: `className="absolute top-3 right-3 size-6 rounded-md text-very-dim hover:bg-white/5 hover:text-text inline-flex items-center justify-center"`

- [ ] **Step 3:** Type-check + lint.

```bash
pnpm --filter ui typecheck && pnpm --filter ui lint
```

- [ ] **Step 4:** Visual verify: trigger any dialog in the app (e.g., `New task` form opens a dialog). Confirm: rounded corners, drop shadow with subtle ambient glow, header has the radial wash if destructive, slide-in animation feels snappy (<200ms).

- [ ] **Step 5:** Commit.

```bash
git add ui/src/components/ui/dialog.tsx
git commit -m "feat(ui): restyle Dialog to polished modal pattern

Applies design-system §9.3 Modal-B pattern: 16px radius,
soft shadow with subtle brand-red ambient glow, body bg with
optional radial wash for destructive variants, slide-up +
fade-in animation 160ms ease-out, close X top-right."
```

---

## Task 4: Restyle `AlertDialog` (destructive modal)

**Files:**
- Modify: `ui/src/components/ui/alert-dialog.tsx`

**Spec reference:** [§9.3 Modals](../design/design-system.md#93-modals) — destructive variant rules.

**Steps:**

- [ ] **Step 1:** Read current `alert-dialog.tsx`. AlertDialog typically has the same surface treatment as Dialog plus a destructive-icon convention.

- [ ] **Step 2:** Apply the same content/header/footer styles as Dialog (Task 3) PLUS the destructive radial wash on the body bg:
  - `AlertDialogHeader`: `className="px-7 pt-7 pb-5 relative bg-[radial-gradient(ellipse_90%_60%_at_50%_-20%,rgba(239,68,68,0.08)_0%,transparent_70%)]"`
  - Add a 48px haloed icon convention: a `<div>` slot with `className="inline-flex w-12 h-12 rounded-full bg-error/10 text-error items-center justify-center text-xl shadow-[0_0_0_6px_rgba(239,68,68,0.05)] mb-3.5"` wrapping a Lucide icon (e.g., `<AlertTriangle />`).
  - `AlertDialogTitle`: same as Dialog (`text-[1.15rem] font-bold ...`).
  - `AlertDialogDescription`: same as Dialog. Allow inline `<code>` for target name.
  - `AlertDialogAction`: should already be a `Button variant="destructive"` — confirm.
  - `AlertDialogCancel`: should be `Button variant="secondary"` — confirm.

- [ ] **Step 3:** Type-check + lint.

- [ ] **Step 4:** Visual verify: trigger a destructive flow if any exists (e.g., archive workspace from `WorkspaceCloseDialog`). Confirm: icon halo glow visible, destructive button is system red (not brand red), description supports inline mono.

- [ ] **Step 5:** Commit.

```bash
git add ui/src/components/ui/alert-dialog.tsx
git commit -m "feat(ui): restyle AlertDialog with haloed destructive icon

Inherits Dialog modal surface + adds 48px haloed icon
convention for destructive flows. Description supports
inline <code> for target names per §9.3."
```

---

## Task 5: Restyle `Sheet` (slideover pattern)

**Files:**
- Modify: `ui/src/components/ui/sheet.tsx`

**Spec reference:** [§9.4 Sheets](../design/design-system.md#94-sheets-slideovers).

**Steps:**

- [ ] **Step 1:** Read current `sheet.tsx`. Identify the variants (side="right", side="left", etc.).

- [ ] **Step 2:** Update:

- `SheetOverlay`: `bg-black/35 backdrop-blur-[1px]`
- `SheetContent` (side=right, default): `w-[380px] sm:w-[480px] xl:w-[600px] bg-card border-l border-border shadow-[-32px_0_80px_rgba(0,0,0,0.55)] data-[state=open]:animate-in data-[state=open]:slide-in-from-right-5 data-[state=open]:fade-in-0 duration-180 ease-out`
- `SheetHeader`: `px-5 pt-4 pb-3 border-b border-border bg-[radial-gradient(ellipse_80%_100%_at_30%_-20%,rgba(184,45,28,0.10)_0%,transparent_70%)] relative`
- `SheetTitle`: `text-base font-semibold tracking-[-0.01em] flex items-center gap-2.5` (allow status dot before title via composition)
- `SheetDescription`: keep simple
- `SheetFooter`: `px-5 py-3 border-t border-border flex gap-2 justify-end bg-hd`

- [ ] **Step 3:** Type-check + lint.

- [ ] **Step 4:** Visual verify: open a TaskSlideOver (click any task). Confirm: 380px wide, header has subtle red wash, slide-in 180ms feels right, footer right-aligned.

- [ ] **Step 5:** Commit.

```bash
git add ui/src/components/ui/sheet.tsx
git commit -m "feat(ui): restyle Sheet to polished slideover pattern

Applies §9.4 Sheet-B pattern: 380px default width, subtle
red wash on header, slide-in 180ms ease-out, partial
backdrop (35% opacity, 1px blur) so context behind stays
visible."
```

---

## Task 6: Restyle `Popover` + `DropdownMenu`

**Files:**
- Modify: `ui/src/components/ui/popover.tsx`
- Modify: `ui/src/components/ui/dropdown-menu.tsx`

**Spec reference:** [§9.5 Popovers](../design/design-system.md#95-popovers).

**Steps:**

- [ ] **Step 1:** Read both files. DropdownMenu typically extends popover styling.

- [ ] **Step 2:** `PopoverContent`:
- `min-w-[220px] bg-card border border-border rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.4),0_16px_36px_rgba(0,0,0,0.3)] p-1.5 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1 duration-140 ease-out`

`DropdownMenuContent`: same styling as PopoverContent.

`DropdownMenuItem`: `px-2.5 py-1.5 rounded-[5px] text-sm flex items-center gap-2.5 cursor-pointer hover:bg-white/5 data-[highlighted]:bg-white/5 outline-none`

`DropdownMenuSeparator`: `h-px bg-border-soft my-1 -mx-1.5`

- [ ] **Step 3:** Type-check + lint.

- [ ] **Step 4:** Visual verify: open any kebab menu or filter dropdown. Confirm: 220px min-width, 8px radius, soft shadow, slide-down animation 140ms.

- [ ] **Step 5:** Commit.

```bash
git add ui/src/components/ui/popover.tsx ui/src/components/ui/dropdown-menu.tsx
git commit -m "feat(ui): restyle Popover + DropdownMenu

§9.5 Popover-A list pattern: 220px min, 8px radius,
shadow-sm, 140ms slide-down + fade. DropdownMenu inherits
the same surface styling for cohesion."
```

---

## Task 7: Restyle `Tabs` (sliding underline)

**Files:**
- Modify: `ui/src/components/ui/tabs.tsx`

**Spec reference:** [§9.12 Tabs](../design/design-system.md#912-tabs).

**Steps:**

- [ ] **Step 1:** Read current `tabs.tsx`. Note that Radix Tabs primitives don't natively do sliding underlines — we'll need to either use a CSS pseudo-element on the active trigger OR use a separate animated indicator div.

- [ ] **Step 2:** For simpler v1, use the per-trigger underline approach (instant border change) but add transition timing so it eases:

`TabsList`: `flex border-b border-border`

`TabsTrigger`: `px-4 py-2.5 text-sm text-dim hover:text-text data-[state=active]:text-text data-[state=active]:font-medium border-b-2 border-transparent data-[state=active]:border-brand -mb-px transition-colors duration-180 ease-out flex items-center gap-1.5 cursor-pointer`

For full sliding underline (smoother, optional v2): add a layout effect that measures the active trigger's `getBoundingClientRect` and animates a `<span>` indicator's `left` + `width`. Skip for v1 unless we hit time.

- [ ] **Step 3:** Type-check + lint.

- [ ] **Step 4:** Visual verify: navigate to any page with tabs (e.g., `MemoryView` if it has tabs). Confirm: brand-red underline on active, hover lifts text color, transition smooth.

- [ ] **Step 5:** Commit.

```bash
git add ui/src/components/ui/tabs.tsx
git commit -m "feat(ui): restyle Tabs with brand-red underline

§9.12 Tab pattern: 2px brand-red underline on active,
hover lifts text color, 180ms ease-out transition. Full
sliding-underline indicator deferred to v2 — instant border
swap is fine for now."
```

---

## Task 8: Restyle `Tooltip` (frosted glass)

**Files:**
- Modify: `ui/src/components/ui/tooltip.tsx`

**Spec reference:** [§9.10 Tooltips](../design/design-system.md#910-tooltips).

**Steps:**

- [ ] **Step 1:** Read current `tooltip.tsx`.

- [ ] **Step 2:** Update `TooltipContent`:

```
bg-[oklch(0.98_0.005_30)] dark:bg-[oklch(0.98_0.005_30)] text-[hsl(20_12%_18%)]
text-xs font-medium px-2.5 py-1 rounded-md
backdrop-blur-md backdrop-saturate-150
shadow-[0_2px_6px_rgba(0,0,0,0.4),0_8px_18px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.7)]
border border-white/40
data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95
duration-140
```

In the wrapping `Tooltip` component, set `delayDuration={100}` so tooltips don't pop on every hover.

- [ ] **Step 3:** Type-check + lint.

- [ ] **Step 4:** Visual verify: hover any icon button. Confirm: light bg on dark mode, slight delay before appearing, smooth fade.

- [ ] **Step 5:** Commit.

```bash
git add ui/src/components/ui/tooltip.tsx
git commit -m "feat(ui): restyle Tooltip with frosted-glass treatment

§9.10 Tooltip-B: backdrop-blur-md + saturate-150, inset
top highlight, 100ms hover delay, 140ms scale+fade in."
```

---

## Task 9: Restyle `Badge` (gradient + glow + live pulse)

**Files:**
- Modify: `ui/src/components/ui/badge.tsx`

**Spec reference:** [§9.11 Status badges](../design/design-system.md#911-status-badges).

**Steps:**

- [ ] **Step 1:** Read current `badge.tsx`.

- [ ] **Step 2:** Replace `badgeVariants` to support our 7 status variants + optional dot:

```ts
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[0.66rem] font-semibold uppercase tracking-[0.04em] border bg-gradient-to-b",
  {
    variants: {
      variant: {
        active:   "from-success/[0.18] to-success/[0.12] text-[hsl(150_50%_70%)] border-success/25",
        live:     "from-brand/[0.22] to-brand/[0.14] text-[hsl(15_70%_78%)] border-brand/30",
        idle:     "from-data-slate/[0.16] to-data-slate/[0.08] text-[hsl(220_14%_75%)] border-data-slate/[0.22]",
        pending:  "from-warning/[0.20] to-warning/[0.12] text-[hsl(45_70%_70%)] border-warning/[0.28]",
        error:    "from-error/[0.18] to-error/[0.10] text-[hsl(0_80%_75%)] border-error/[0.28]",
        draft:    "from-info/[0.18] to-info/[0.10] text-[hsl(220_75%_75%)] border-info/[0.25]",
        archived: "bg-card text-dim border-border bg-none",
      },
    },
    defaultVariants: { variant: "active" },
  }
);
```

Add a `Dot` component or render via children: `<span className="size-1.5 rounded-full bg-current shadow-[0_0_6px_currentColor]" />`. For `live` variant, the dot animates: add an `animate-pulse-glow` class.

- [ ] **Step 3:** Type-check + lint.

- [ ] **Step 4:** Visual verify: navigate to Tasks page where badges show statuses. Confirm: subtle gradient inside pill, dot glow visible, live state pulses.

- [ ] **Step 5:** Commit.

```bash
git add ui/src/components/ui/badge.tsx
git commit -m "feat(ui): restyle Badge with gradient + glow + live pulse

§9.11 Badge-B: 7 variants (active/live/idle/pending/error/
draft/archived) using semantic colors. Subtle top-bottom
gradient inside pill, colored dot glow, pulsing ring on live."
```

---

## Task 10: Restyle `Input` + `Textarea`

**Files:**
- Modify: `ui/src/components/ui/input.tsx`
- Modify: `ui/src/components/ui/textarea.tsx`

**Spec reference:** [§9.2 Forms](../design/design-system.md#92-inputs--forms).

**Steps:**

- [ ] **Step 1:** Read both files.

- [ ] **Step 2:** Update Input class:

```
flex h-8 w-full rounded-md border border-border bg-field px-3 py-1.5 text-sm transition-colors
hover:bg-[oklch(0.15_0.005_30)]
focus-visible:outline-none focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand-tint-15
placeholder:text-very-dim
disabled:opacity-50 disabled:cursor-not-allowed
aria-[invalid=true]:border-error aria-[invalid=true]:focus-visible:ring-error/[0.18]
```

Textarea: same as Input but `min-h-[76px] resize-y py-2`.

- [ ] **Step 3:** Type-check + lint.

- [ ] **Step 4:** Visual verify: open any form (e.g., New task). Confirm: 32px height, 6px radius, brand-red focus ring at 15% opacity, error state shows red border + ring.

- [ ] **Step 5:** Commit.

```bash
git add ui/src/components/ui/input.tsx ui/src/components/ui/textarea.tsx
git commit -m "feat(ui): restyle Input + Textarea per form spec

§9.2 input pattern: 32px height, 6px radius, brand-red
focus ring (3px @ 15% opacity), error state via aria-invalid."
```

---

## Task 11: Restyle `Label` + `Checkbox` + `Select`

**Files:**
- Modify: `ui/src/components/ui/label.tsx`
- Modify: `ui/src/components/ui/checkbox.tsx`
- Modify: `ui/src/components/ui/select.tsx`

**Spec reference:** [§9.2 Forms](../design/design-system.md#92-inputs--forms).

**Steps:**

- [ ] **Step 1:** Read all three.

- [ ] **Step 2:**
- `Label`: `text-sm font-medium text-text peer-disabled:cursor-not-allowed peer-disabled:opacity-50`. Add helper for required asterisk: a `<RequiredMark>` slot that renders `<span className="text-brand ml-0.5 font-semibold">*</span>`.
- `Checkbox`: 16×16 (`size-4`), `rounded-[4px] border border-border-strong bg-field data-[state=checked]:bg-brand data-[state=checked]:border-brand`. Check icon uses brand-foreground (white).
- `Select` trigger: same input styling as `Input`. Custom dropdown arrow via `[&>svg]:opacity-50`. Content: `bg-card-2 border border-border rounded-lg shadow-sm` matching Popover.

- [ ] **Step 3:** Type-check + lint.

- [ ] **Step 4:** Visual verify: open any form with checkboxes + selects (e.g., New agent if it exists, or Settings). Confirm: brand-red checkboxes when checked, select trigger looks like input.

- [ ] **Step 5:** Commit.

```bash
git add ui/src/components/ui/label.tsx ui/src/components/ui/checkbox.tsx ui/src/components/ui/select.tsx
git commit -m "feat(ui): restyle Label + Checkbox + Select"
```

---

## Verification Gate A — after primitive restyling

> Run before starting Task 12. Catches any regressions introduced by Tasks 1–11.

**Files:** none (verification only)

**Steps:**

- [ ] **Step 1:** Run full vitest suite.

```bash
pnpm --filter ui test:run
```

Expected: all existing tests pass. None of the modified primitives (Button, Dialog, Sheet, Popover, Tabs, Tooltip, Badge, Input, Textarea, Label, Checkbox, Select) should have broken — they're presentational changes only.

If any test fails, diagnose:
- API break (prop renamed) → update the test, recommit with the fix referenced
- Behavior break (component broke) → fix the component, NOT the test
- Style assertion (`toHaveClass`) → expected if test asserts on old class names; update to new class names

- [ ] **Step 2:** Run a fast subset of e2e specs.

```bash
pnpm test:e2e -- onboarding sign-out-flow keyboard-cheatsheet
```

Expected: 3 specs pass. They exercise primitives across real flows (sign-up button → modal → form submit → navigation).

If any e2e fails, screenshot the failure and diagnose the same way.

- [ ] **Step 3:** Run dev server and walk a visual checkpoint:

```bash
pnpm dev
```

Visit and visually confirm:
- `/` (Lobby) — buttons render, modals open
- Sign in / Sign up — focus rings brand-red
- Any page with `Sheet` (Tasks slideover) — slides in correctly
- Any page with `Tabs` — underline brand-red on active

Capture any visual issues for fix before proceeding.

- [ ] **Step 4:** STOP if anything failed. Fix in a focused commit, then re-run Gate A. Don't accumulate failures into Phase 2.

No commit for this gate.

---

## Task 12: Create `Switch` and `RadioGroup` primitives

**Files:**
- Create: `ui/src/components/ui/switch.tsx`
- Create: `ui/src/components/ui/radio-group.tsx`

**Spec reference:** [§9.2 Forms](../design/design-system.md#92-inputs--forms).

**Steps:**

- [ ] **Step 1:** Install if not present: check `package.json` in `ui/` for `@radix-ui/react-switch` and `@radix-ui/react-radio-group`. If missing, add:

```bash
pnpm --filter ui add @radix-ui/react-switch @radix-ui/react-radio-group
```

- [ ] **Step 2:** Create `switch.tsx`:

```tsx
"use client";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";
import * as React from "react";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    className={cn(
      "peer inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-tint-15 disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:bg-brand data-[state=unchecked]:bg-[hsl(0_0%_25%)]",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block size-3.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0.5" />
  </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };
```

- [ ] **Step 3:** Create `radio-group.tsx`:

```tsx
"use client";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import * as React from "react";

const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root className={cn("grid gap-1.5", className)} {...props} ref={ref} />
));
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    className={cn(
      "size-4 rounded-full border border-border-strong bg-field text-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-tint-15 disabled:opacity-50",
      "data-[state=checked]:border-brand",
      className
    )}
    {...props}
    ref={ref}
  >
    <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
      <Circle className="size-1.5 fill-brand text-brand" />
    </RadioGroupPrimitive.Indicator>
  </RadioGroupPrimitive.Item>
));
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;

export { RadioGroup, RadioGroupItem };
```

- [ ] **Step 4:** Type-check + lint.

- [ ] **Step 5:** Commit.

```bash
git add ui/src/components/ui/switch.tsx ui/src/components/ui/radio-group.tsx ui/package.json ui/pnpm-lock.yaml
git commit -m "feat(ui): add Switch + RadioGroup primitives

Missing from existing shadcn primitive set. 32×18 brand-red
switch per §9.2, 16×16 brand-bordered radio per §9.2."
```

---

## Task 13: Restyle `Avatar` for dept-colored initials

**Files:**
- Modify: `ui/src/components/ui/avatar.tsx`
- May modify: `ui/src/lib/avatar-color.ts` (create if needed)

**Spec reference:** [§11 Avatars](../design/design-system.md#11-avatars).

**Steps:**

- [ ] **Step 1:** Read current `avatar.tsx`. Identify `AvatarImage` and `AvatarFallback` exports.

- [ ] **Step 2:** Create or update `ui/src/lib/avatar-color.ts`:

```ts
/**
 * Returns one of the 6 data-palette CSS-var names based on a string seed
 * (typically agent slug or dept). Same seed always returns same color.
 */
const PALETTE = [
  "var(--data-teal)",
  "var(--data-indigo)",
  "var(--data-green)",
  "var(--data-amber)",
  "var(--data-magenta)",
  "var(--data-slate)",
] as const;

export function avatarColorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function initialsFor(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
```

- [ ] **Step 3:** Update `avatar.tsx` to use these:

```tsx
"use client";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn } from "@/lib/utils";
import { avatarColorFor, initialsFor } from "@/lib/avatar-color";
import * as React from "react";

const sizes = {
  xs: "size-[18px] text-[0.62rem]",
  sm: "size-6 text-[0.7rem]",
  md: "size-8 text-sm",
  lg: "size-10 text-base",
  xl: "size-14 text-lg",
} as const;

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & {
    size?: keyof typeof sizes;
    seed?: string;
    name?: string;
    src?: string;
  }
>(({ className, size = "md", seed, name, src, ...props }, ref) => {
  const initials = name ? initialsFor(name) : "?";
  const bgColor = seed ? avatarColorFor(seed) : "var(--data-slate)";
  return (
    <AvatarPrimitive.Root
      className={cn("relative inline-flex shrink-0 overflow-hidden rounded-full", sizes[size], className)}
      {...props}
      ref={ref}
    >
      {src && <AvatarPrimitive.Image src={src} className="aspect-square h-full w-full object-cover" />}
      <AvatarPrimitive.Fallback
        className="flex h-full w-full items-center justify-center font-bold text-white tracking-[-0.01em]"
        style={{ backgroundColor: bgColor }}
      >
        {initials}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
});
Avatar.displayName = AvatarPrimitive.Root.displayName;

export { Avatar };
```

- [ ] **Step 4:** Search the codebase for existing Avatar usages and confirm signature compatibility (some callers may pass children directly):

```bash
grep -rn "from.*avatar" ui/src --include="*.tsx" --include="*.ts"
```

If existing callers pass children manually, keep backwards-compat by accepting `children` and rendering them inside fallback when no `name`/`src`.

- [ ] **Step 5:** Type-check + lint.

- [ ] **Step 6:** Commit.

```bash
git add ui/src/components/ui/avatar.tsx ui/src/lib/avatar-color.ts
git commit -m "feat(ui): restyle Avatar with dept-colored initials

§11 Avatar pattern: 5 sizes (xs/sm/md/lg/xl), initials from
displayName (max 2 chars), bg from data palette via stable
hash of seed."
```

---

## Task 14: Restyle `Skeleton` for gradient sweep

**Files:**
- Modify: `ui/src/components/ui/skeleton.tsx`

**Spec reference:** [§9.9 Loading skeletons](../design/design-system.md#99-loading-skeletons).

**Steps:**

- [ ] **Step 1:** Read current `skeleton.tsx`.

- [ ] **Step 2:** Replace with gradient-sweep version:

```tsx
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-md animate-shimmer",
        "bg-gradient-to-r from-field via-card-2 to-field",
        "bg-[length:200%_100%]",
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
```

The `animate-shimmer` keyframe is already added in Task 1 (`background-position` from -120% to 220% over 1.6s).

- [ ] **Step 3:** Verify other primitives that use `Skeleton` still render. Type-check.

- [ ] **Step 4:** Visual verify: navigate to a page with loading state (any list while data fetches). Confirm: gradient sweep visible, smooth motion, ~1.6s loop.

- [ ] **Step 5:** Commit.

```bash
git add ui/src/components/ui/skeleton.tsx
git commit -m "feat(ui): replace Skeleton opacity-pulse with gradient sweep

§9.9 Loading-B pattern: gradient sweeps left-to-right
(1.6s linear loop). Eye tracks motion better than opacity
pulse — Stripe / Linear / GitHub all use this."
```

---

## Task 15: Restyle `Breadcrumb` to spec

**Files:**
- Modify: `ui/src/components/ui/breadcrumb.tsx`

**Spec reference:** [§13 Breadcrumb](../design/design-system.md#13-breadcrumb).

**Steps:**

- [ ] **Step 1:** Read current `breadcrumb.tsx`.

- [ ] **Step 2:** Update class names:

- `Breadcrumb` (root): no change to structure
- `BreadcrumbList`: `flex flex-wrap items-center gap-1 text-[0.66rem] tracking-[0.04em]`
- `BreadcrumbItem`: `inline-flex items-center gap-1`
- `BreadcrumbLink`: `text-very-dim hover:text-text transition-colors`
- `BreadcrumbPage` (current item, plain): `text-text`
- `BreadcrumbSeparator`: render `·` middle dot in `text-very-dim`

For "max 3 levels visible — truncate middle: `Company · … · Domain`": this is consumer logic; provide a `BreadcrumbEllipsis` component (already in shadcn breadcrumb).

- [ ] **Step 3:** Type-check + lint.

- [ ] **Step 4:** Commit.

```bash
git add ui/src/components/ui/breadcrumb.tsx
git commit -m "feat(ui): restyle Breadcrumb to design-system spec

§13: 0.66rem font, 0.04em letter-spacing, middle-dot
separator, dim parent links + plain current."
```

---

## Task 16: Create `StatusDot` + `MetaPill` primitives

**Files:**
- Create: `ui/src/components/ui/status-dot.tsx`
- Create: `ui/src/components/ui/meta-pill.tsx`

**Spec reference:** [§9.4 Sheets](../design/design-system.md#94-sheets-slideovers) (uses these), [§9.11 Badges](../design/design-system.md#911-status-badges).

**Steps:**

- [ ] **Step 1:** Create `status-dot.tsx`:

```tsx
import { cn } from "@/lib/utils";

const colorMap = {
  active: "bg-success shadow-[0_0_0_2px_var(--brand-tint-08)] [box-shadow:0_0_0_2px_rgba(79,182,126,0.18)]",
  live: "bg-brand animate-pulse-glow",
  idle: "bg-data-slate",
  pending: "bg-warning [box-shadow:0_0_0_2px_rgba(217,169,56,0.18)]",
  error: "bg-error [box-shadow:0_0_0_2px_rgba(239,68,68,0.18)]",
  draft: "bg-info [box-shadow:0_0_0_2px_rgba(59,130,246,0.18)]",
} as const;

export type StatusDotVariant = keyof typeof colorMap;

export function StatusDot({ variant = "active", className }: { variant?: StatusDotVariant; className?: string }) {
  return <span className={cn("inline-block size-2 rounded-full", colorMap[variant], className)} aria-hidden />;
}
```

- [ ] **Step 2:** Create `meta-pill.tsx`:

```tsx
import { cn } from "@/lib/utils";
import * as React from "react";

export function MetaPill({ children, className, mono }: { children: React.ReactNode; className?: string; mono?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-[0.66rem] bg-white/[0.05] border border-border text-dim",
        mono && "font-mono",
        className
      )}
    >
      {children}
    </span>
  );
}

export function MetaPillRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-1.5 mt-2">{children}</div>;
}
```

- [ ] **Step 3:** Type-check + lint.

- [ ] **Step 4:** Commit.

```bash
git add ui/src/components/ui/status-dot.tsx ui/src/components/ui/meta-pill.tsx
git commit -m "feat(ui): add StatusDot + MetaPill primitives

StatusDot: 6 variants (active/live/idle/pending/error/draft)
with semantic-colored glow. Live state pulses.
MetaPill + MetaPillRow: header meta-pill row pattern from
§9.4 Sheet B."
```

---

## Task 17: Create `EmptyState` primitive

**Files:**
- Create: `ui/src/components/ui/empty-state.tsx`

**Spec reference:** [§9.8 Empty states](../design/design-system.md#98-empty-states).

**Steps:**

- [ ] **Step 1:** Create:

```tsx
import { cn } from "@/lib/utils";
import * as React from "react";

export type EmptyStateVariant = "first-time" | "no-results";

export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = "first-time",
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  variant?: EmptyStateVariant;
  className?: string;
}) {
  const iconBg = variant === "first-time" ? "bg-brand-tint-08 border-brand/20 text-brand" : "bg-card-2 border-border text-dim";
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center p-6",
        "bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,var(--brand-tint-08)_0%,transparent_70%)]",
        className
      )}
    >
      {icon && (
        <div className={cn("flex size-14 rounded-2xl border items-center justify-center text-2xl mb-3.5", iconBg)}>
          {icon}
        </div>
      )}
      <div className="text-base font-semibold tracking-[-0.01em] mb-1.5">{title}</div>
      {description && <div className="text-sm text-dim leading-relaxed max-w-[320px] mb-3.5">{description}</div>}
      {action && <div>{action}</div>}
    </div>
  );
}
```

- [ ] **Step 2:** Type-check + lint.

- [ ] **Step 3:** Commit.

```bash
git add ui/src/components/ui/empty-state.tsx
git commit -m "feat(ui): add EmptyState composite

§9.8 pattern: 56px iconWith brand-tinted bg (first-time) or
neutral (no-results), title + description + action, subtle
brand-red radial wash on bg."
```

---

## Task 18: Create `Stepper` component

**Files:**
- Create: `ui/src/components/ui/stepper.tsx`

**Spec reference:** [§9.6 Stepper](../design/design-system.md#96-stepper-navigable).

**Steps:**

- [ ] **Step 1:** Create with horizontal-pill (default), vertical, and dots variants:

```tsx
import { cn } from "@/lib/utils";

export type Step = {
  id: string;
  label: string;
  description?: string;
};

export type StepperVariant = "horizontal" | "vertical" | "dots";

export function Stepper({
  steps,
  current,
  onStepClick,
  variant = "horizontal",
  className,
}: {
  steps: Step[];
  current: number;
  onStepClick?: (index: number) => void;
  variant?: StepperVariant;
  className?: string;
}) {
  if (variant === "dots") {
    return (
      <div className={cn("flex items-center gap-1.5", className)}>
        {steps.map((_, i) => {
          const state = i < current ? "done" : i === current ? "active" : "pending";
          return (
            <span
              key={i}
              className={cn(
                "size-2 rounded-full bg-[hsl(0_0%_25%)] cursor-pointer transition-all",
                state === "active" && "w-[22px] bg-brand shadow-[0_0_0_3px_var(--brand-tint-15)]",
                state === "done" && "bg-brand opacity-60",
                onStepClick && state !== "pending" && "cursor-pointer"
              )}
              onClick={() => onStepClick && state !== "pending" && onStepClick(i)}
            />
          );
        })}
      </div>
    );
  }

  if (variant === "vertical") {
    return (
      <div className={cn("flex flex-col", className)}>
        {steps.map((s, i) => {
          const state = i < current ? "done" : i === current ? "active" : "pending";
          const clickable = onStepClick && state !== "pending";
          return (
            <div
              key={s.id}
              className={cn("flex gap-3 py-2 rounded-md", clickable && "cursor-pointer hover:bg-white/[0.02]")}
              onClick={() => clickable && onStepClick(i)}
            >
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "size-[22px] rounded-full bg-[hsl(0_0%_25%)] text-[hsl(0_0%_75%)] font-mono text-[0.7rem] font-semibold inline-flex items-center justify-center shrink-0 z-10",
                    state === "active" && "bg-brand text-white shadow-[0_0_0_4px_var(--brand-tint-15)]",
                    state === "done" && "bg-brand text-white opacity-70"
                  )}
                >
                  {state === "done" ? "✓" : i + 1}
                </span>
                {i < steps.length - 1 && <div className={cn("flex-1 w-px mt-0.5 min-h-[18px]", state === "done" ? "bg-brand/40" : "bg-[hsl(0_0%_18%)]")} />}
              </div>
              <div className="pt-px pb-3">
                <div className={cn("text-sm font-medium", state === "active" ? "text-text font-semibold" : "text-dim")}>{s.label}</div>
                {s.description && <div className="text-xs text-very-dim mt-0.5">{s.description}</div>}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // horizontal (default)
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "active" : "pending";
        const clickable = onStepClick && state !== "pending";
        return (
          <React.Fragment key={s.id}>
            <div
              className={cn(
                "flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md transition-colors",
                state === "pending" && "text-dim",
                state === "active" && "text-text",
                state === "done" && "text-dim",
                clickable && "cursor-pointer hover:bg-white/[0.04] hover:text-text"
              )}
              onClick={() => clickable && onStepClick(i)}
            >
              <span
                className={cn(
                  "size-[18px] rounded-full bg-[hsl(0_0%_25%)] text-[hsl(0_0%_75%)] font-mono text-[0.66rem] font-semibold inline-flex items-center justify-center shrink-0",
                  state === "active" && "bg-brand text-white shadow-[0_0_0_3px_var(--brand-tint-15)]",
                  state === "done" && "bg-brand text-white opacity-70"
                )}
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              {s.label}
            </div>
            {i < steps.length - 1 && <div className={cn("flex-1 h-px", state === "done" ? "bg-brand/50" : "bg-[hsl(0_0%_18%)]")} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}
```

Add `import * as React from "react";` at top.

- [ ] **Step 2:** Type-check + lint.

- [ ] **Step 3:** Commit.

```bash
git add ui/src/components/ui/stepper.tsx
git commit -m "feat(ui): add Stepper component (3 variants)

§9.6: horizontal pill (default), vertical with sub-text,
dots-only. All navigable — done + active are clickable."
```

---

## Task 19: Create `SectionHeader` for forms

**Files:**
- Create: `ui/src/components/ui/section-header.tsx`

**Spec reference:** [§9.2 Forms](../design/design-system.md#92-inputs--forms) (used in polished form sections).

**Steps:**

- [ ] **Step 1:** Create:

```tsx
import { cn } from "@/lib/utils";

export function SectionHeader({
  number,
  icon,
  children,
  className,
}: {
  number?: number;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("text-[0.62rem] uppercase tracking-[0.1em] text-dim mb-3 flex items-center gap-2 font-semibold", className)}>
      {number !== undefined && (
        <span className="size-[18px] rounded-full bg-brand-tint-15 text-brand inline-flex items-center justify-center font-mono text-[0.66rem] font-bold">
          {number}
        </span>
      )}
      {icon && <span className="text-current opacity-60">{icon}</span>}
      <span>{children}</span>
    </div>
  );
}
```

- [ ] **Step 2:** Type-check.

- [ ] **Step 3:** Commit.

```bash
git add ui/src/components/ui/section-header.tsx
git commit -m "feat(ui): add SectionHeader for form sections

§9.2 form spec: small-caps section title + optional numeric
badge + optional icon. Used in polished form pattern."
```

---

## Task 20: Create `PageHeader` composite

**Files:**
- Create: `ui/src/components/PageHeader.tsx`

**Spec reference:** [§8.3 Page header anatomy](../design/design-system.md#83-page-header-anatomy).

**Steps:**

- [ ] **Step 1:** Create:

```tsx
import { cn } from "@/lib/utils";
import * as React from "react";

export type PageHeaderProps = {
  breadcrumb?: React.ReactNode;
  title: string;
  subtitle?: string;
  filters?: React.ReactNode;
  search?: React.ReactNode;
  primaryAction?: React.ReactNode;
  className?: string;
};

export function PageHeader({ breadcrumb, title, subtitle, filters, search, primaryAction, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "px-6 pt-5 pb-4 border-b border-border relative",
        "bg-[radial-gradient(ellipse_80%_100%_at_30%_-20%,var(--brand-tint-08)_0%,transparent_70%)]",
        "bg-hd",
        className
      )}
    >
      {breadcrumb && <div className="text-[0.66rem] tracking-[0.04em] text-very-dim mb-1">{breadcrumb}</div>}
      <h1 className="text-[1.4rem] font-bold tracking-[-0.025em] mb-1">{title}</h1>
      {subtitle && <div className="text-[0.82rem] text-dim mb-3">{subtitle}</div>}
      {(filters || search || primaryAction) && (
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {filters}
          <div className="flex-1" />
          {search}
          {primaryAction}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2:** Type-check.

- [ ] **Step 3:** Commit.

```bash
git add ui/src/components/PageHeader.tsx
git commit -m "feat(ui): add PageHeader composite

§8.3 Page header anatomy: breadcrumb + title + subtitle +
action row (filter pills left, search + primary right) with
subtle radial brand wash bg."
```

---

## Task 21: Create `SecondarySidebar` composite

**Files:**
- Create: `ui/src/components/SecondarySidebar.tsx`

**Spec reference:** [§8.1 App shell](../design/design-system.md#81-app-shell) + [§8.2 Sidebar collapse](../design/design-system.md#82-sidebar-collapse).

**Steps:**

- [ ] **Step 1:** Create:

```tsx
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";

export type SecondarySidebarSection = {
  title: string;
  items: SecondarySidebarItem[];
};

export type SecondarySidebarItem = {
  id: string;
  label: string;
  count?: number;
  icon?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
};

export function SecondarySidebar({
  sections,
  collapsed = false,
  onToggleCollapse,
  className,
}: {
  sections: SecondarySidebarSection[];
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-r border-border bg-[oklch(0.155_0.005_30)] flex flex-col",
        collapsed ? "w-12 px-1" : "w-50 px-2",
        "py-3.5 transition-[width] duration-180",
        className
      )}
    >
      {sections.map((section, idx) => (
        <div key={idx} className={cn(idx > 0 && "mt-2 pt-2 border-t border-border-soft")}>
          {!collapsed && (
            <div className="text-[0.62rem] uppercase tracking-[0.1em] text-very-dim px-2.5 py-1 mb-1 font-semibold">
              {section.title}
            </div>
          )}
          {section.items.map((item) => (
            <button
              key={item.id}
              onClick={item.onClick}
              title={collapsed ? item.label : undefined}
              className={cn(
                "w-full grid items-center gap-2 px-2.5 py-2 rounded-md text-sm text-text/[0.78] transition-colors",
                collapsed ? "grid-cols-[20px] justify-center" : "grid-cols-[1fr_auto]",
                "hover:bg-white/[0.04]",
                item.active && "bg-white/[0.06] text-text font-medium shadow-[inset_2px_0_0_var(--brand)]"
              )}
            >
              {collapsed ? (
                <span className="text-current">{item.icon ?? item.label[0]}</span>
              ) : (
                <>
                  <span className="text-left flex items-center gap-2">
                    {item.icon}
                    {item.label}
                  </span>
                  {item.count !== undefined && (
                    <span className={cn("font-mono text-[0.68rem] text-very-dim", item.active && "text-text/[0.8]")}>{item.count}</span>
                  )}
                </>
              )}
            </button>
          ))}
        </div>
      ))}
      {onToggleCollapse && (
        <button
          onClick={onToggleCollapse}
          className="mt-auto mx-2 my-2 size-7 rounded-md text-very-dim hover:bg-white/[0.04] hover:text-text inline-flex items-center justify-center"
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2:** Type-check.

- [ ] **Step 3:** Commit.

```bash
git add ui/src/components/SecondarySidebar.tsx
git commit -m "feat(ui): add SecondarySidebar composite

§8.1 + §8.2: page-scoped sidebar with sections, item count
badges, brand-red active state (inset border), collapsible
to icon-only, label-tooltip on hover when collapsed."
```

---

## Task 22: Create `Toaster` (toast root) using sonner

**Files:**
- Create: `ui/src/components/ui/toaster.tsx`
- Modify: `ui/src/main.tsx` or `ui/src/App.tsx` (add `<Toaster />` mount)
- May modify: `ui/package.json` (add `sonner`)

**Spec reference:** [§9.7 Toasts](../design/design-system.md#97-toasts).

**Steps:**

- [ ] **Step 1:** Add sonner if not installed:

```bash
pnpm --filter ui add sonner
```

- [ ] **Step 2:** Create `toaster.tsx`:

```tsx
"use client";
import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="top-right"
      theme="dark"
      duration={4000}
      toastOptions={{
        className: "!bg-card-2 !border !border-border !rounded-lg !shadow-[0_4px_12px_rgba(0,0,0,0.35),0_16px_36px_rgba(0,0,0,0.25)]",
        classNames: {
          title: "!text-sm !font-semibold",
          description: "!text-xs !text-dim",
          success: "!border-l-[3px] !border-l-success",
          error: "!border-l-[3px] !border-l-error",
          warning: "!border-l-[3px] !border-l-warning",
          info: "!border-l-[3px] !border-l-info",
        },
      }}
    />
  );
}
```

- [ ] **Step 3:** Mount `<Toaster />` once at the app root (likely `ui/src/App.tsx` near the providers). Read that file first to confirm the right location.

- [ ] **Step 4:** Add a helper for app-wide toast usage in `ui/src/lib/toast.ts`:

```ts
import { toast as sonnerToast } from "sonner";

export const toast = {
  success: (title: string, description?: string) => sonnerToast.success(title, { description }),
  error: (title: string, description?: string) => sonnerToast.error(title, { description, duration: 8000 }),
  warning: (title: string, description?: string) => sonnerToast.warning(title, { description }),
  info: (title: string, description?: string) => sonnerToast.info(title, { description }),
};
```

- [ ] **Step 5:** Type-check + visual verify (trigger a success toast manually in dev, e.g. via DevTools console: `__toast__?.success("Hello", "World")` if exposed; otherwise add a temporary button).

- [ ] **Step 6:** Commit.

```bash
git add ui/src/components/ui/toaster.tsx ui/src/lib/toast.ts ui/src/App.tsx ui/package.json ui/pnpm-lock.yaml
git commit -m "feat(ui): add Toaster (sonner) with design-system styling

§9.7: top-right placement, 4s default / 8s for errors,
border-left semantic accent, card-2 bg, dual shadow."
```

---

## Verification Gate B — after new-primitive creation

> Run before Task 23 (final smoke test). Catches regressions from Tasks 12–22 (the 9 new primitives + Switch/RadioGroup additions).

**Files:** none (verification only)

**Steps:**

- [ ] **Step 1:** Run full vitest suite.

```bash
pnpm --filter ui test:run
```

Expected: all tests pass — including the 8+ new tests added in Tasks 12, 16, 17, 18, 19, 20, 21, 22.

- [ ] **Step 2:** Run the same fast e2e subset.

```bash
pnpm test:e2e -- onboarding sign-out-flow keyboard-cheatsheet
```

Expected: 3 specs still pass. New primitives shouldn't break existing flows since they're additions; existing flows shouldn't be touching them yet.

- [ ] **Step 3:** Spot-check that new primitives render in dev. Open dev console and import each one, render a sample. Or add a temporary `/__playground` route. Goal: confirm Switch toggles, RadioGroup selects, EmptyState renders with icon + title + description + action, Stepper renders all 3 variants, etc.

- [ ] **Step 4:** STOP if anything failed. Fix in a focused commit, then re-run Gate B.

No commit for this gate.

---

## Task 23: Phase 1 smoke test

**Files:**
- No file changes — this is a verification task only.

**Steps:**

- [ ] **Step 1:** Build the UI bundle:

```bash
pnpm --filter ui build
```

Expected: clean build, no warnings about missing tokens or broken imports.

- [ ] **Step 2:** Run dev server:

```bash
pnpm dev
```

- [ ] **Step 3:** Walk every major page, capture before/after-feeling notes:

  - `/` (Home / Lobby)
  - `/c/<company>/inbox`
  - `/c/<company>/discussions`
  - `/c/<company>/issues` (Tasks)
  - `/c/<company>/agents`
  - `/c/<company>/goals`
  - `/c/<company>/memory`
  - `/c/<company>/budget`
  - `/c/<company>/activity`
  - `/c/<company>/settings`

For each: open browser DevTools, screenshot. Verify no broken layouts, no white-on-white text, no missing tokens, no console errors.

- [ ] **Step 4:** Run e2e smoke:

```bash
pnpm test:e2e
```

Expected: all tests pass (token + primitive changes shouldn't break behavior).

- [ ] **Step 5:** **STOP — checkpoint with user.** Phase 1 is complete; Phase 2 starts after user reviews the foundation impact across pages.

No commit for this task — verification only.

---

# Phase 2 — Lobby pilot

> Phase 2 tasks execute **inline** (in the user's session, not via subagents) since the user reviews each per-page change directly.

---

## Task 24: Apply tokens + page-header pattern to Lobby

**Files:**
- Modify: `ui/src/components/LobbySidebar.tsx`
- Modify: `ui/src/pages/Lobby.tsx` (or wherever lobby renders — confirm by searching)
- May modify: `ui/src/components/lobby/*.tsx` if subcomponents exist

**Spec reference:** [§8.3 Page header](../design/design-system.md#83-page-header-anatomy), [§8.4 Gradient placement](../design/design-system.md#84-gradient-placement) — lobby gets full radial wash.

**Steps:**

- [ ] **Step 1:** Locate the lobby files:

```bash
find ui/src -type f -name "Lobby*.tsx" -o -name "*lobby*.tsx" 2>/dev/null
```

- [ ] **Step 2:** Read each lobby file. Catalog what's there:
  - Sidebar component
  - Main content area
  - Empty state for no-companies
  - Cards for existing companies
  - "+ New" action
  - Any old class names referencing pre-design-system colors (e.g., hardcoded hex, `text-zinc-*`, `bg-neutral-*`)

- [ ] **Step 3:** Update the sidebar to use new tokens (replace hardcoded styles with semantic tokens). Active state should use `bg-brand/15 text-text shadow-[inset_2px_0_0_var(--brand)]` instead of any prior treatment.

- [ ] **Step 4:** Apply full radial wash to the main content area. The lobby is a landing surface, so it gets the marketing-tier radial wash:

```tsx
<div className="min-h-screen bg-[radial-gradient(ellipse_at_top,var(--brand-tint-15)_0%,transparent_60%)] bg-bg">
```

- [ ] **Step 5:** Replace any old empty state (no-companies) with the new `<EmptyState />` composite:

```tsx
import { EmptyState } from "@/components/ui/empty-state";
import { Plus } from "lucide-react";

<EmptyState
  icon={<Plus />}
  title="Start your first company"
  description="Companies are workspaces for your AI agents and humans. Each one has its own tasks, goals, and memory."
  action={<Button>+ New company</Button>}
/>
```

- [ ] **Step 6:** Run dev server, navigate to lobby. Confirm: full radial brand wash visible, sidebar uses new active state, cards have new visual.

- [ ] **Step 7:** Type-check + lint.

- [ ] **Step 8:** Commit.

```bash
git add ui/src/components/LobbySidebar.tsx ui/src/pages/Lobby.tsx ui/src/components/lobby/
git commit -m "feat(ui): apply design system tokens + radial wash to Lobby

Phase 2 pilot: Lobby is the first page rebuilt with the
new design system. Validates the foundation (tokens +
primitives) on a real surface. Sidebar uses brand-red
inset active state, main area gets full radial brand wash
per §8.4 (lobby is marketing-tier, not data-dense)."
```

---

## Task 25: Phase 2 visual review checkpoint

**Files:**
- No file changes — review with user.

**Steps:**

- [ ] **Step 1:** Capture screenshots of the redesigned Lobby (both signed-in landing and signed-out / first-time empty state) at desktop (1440px) and tablet (1024px) widths.

- [ ] **Step 2:** **STOP — present to user.** Show screenshots, ask:

  1. Does the lobby feel like the locked design system?
  2. Anything that feels off (spacing, color, typography)?
  3. OK to proceed to Phase 3 (next page — Tasks)?

- [ ] **Step 3:** Capture user feedback. If nudges requested, add fix tasks. If approved, mark Phase 2 complete and prompt user to start Phase 3 planning.

No commit for this task — review only.

---

## Self-review

After writing this plan and before executing, run this checklist:

**1. Spec coverage:** Every section of the design-system doc that involves the foundation layer or Lobby is referenced by at least one task. Verified:
- Color tokens → Task 1 ✓
- Typography (font import) → Task 1 ✓
- Buttons → Task 2 ✓
- Modals → Tasks 3, 4 ✓
- Sheets → Task 5 ✓
- Popover/Dropdown → Task 6 ✓
- Tabs → Task 7 ✓
- Tooltip → Task 8 ✓
- Badge → Task 9 ✓
- Input/Textarea → Task 10 ✓
- Label/Checkbox/Select → Task 11 ✓
- Switch + RadioGroup (new) → Task 12 ✓
- Avatar → Task 13 ✓
- Skeleton → Task 14 ✓
- Breadcrumb → Task 15 ✓
- StatusDot, MetaPill (new) → Task 16 ✓
- EmptyState (new) → Task 17 ✓
- Stepper (new) → Task 18 ✓
- SectionHeader (new) → Task 19 ✓
- PageHeader (new) → Task 20 ✓
- SecondarySidebar (new) → Task 21 ✓
- Toasts → Task 22 ✓
- Smoke test → Task 23 ✓
- Lobby pilot → Tasks 24, 25 ✓

**2. Placeholder scan:** Each task has actual code, file paths, expected commands. No "TBD" or "similar to Task N" without showing what.

**3. Type consistency:** Token names referenced across tasks match (e.g., `--brand` used consistently, never `--primary-brand` or `brandPrimary`). Class names like `bg-brand`, `text-error` consistent.

**Risks:**
- Tailwind v4's `@theme inline` produces utility classes from CSS vars — if a token name isn't valid as a Tailwind utility name, the class won't generate. Tasks 1, 2 should verify utility classes work with `pnpm dev` watch mode.
- `data-state` attributes on Radix primitives may differ between versions — Task 7 (sliding underline tabs) might need adjustment based on the actual `tabs.tsx` Radix version present.
- sonner version compatibility — Task 22 may need v1+ of sonner if breaking API changes happened.

If any task hits an issue, the implementer subagent should:
1. Report the blocker (NEEDS_CONTEXT)
2. Continue if the issue is local to that task
3. Escalate to user if it requires architectural decision

---

## Phase summary for tracking

| Phase | Tasks | Verification gates | Files modified | Files created | Estimated commits |
|-------|-------|--------------------|----------------|---------------|-------------------|
| 1 — Foundation | 23 (tasks 1–23) | 2 (Gate A, Gate B) | 18 | ~21 (incl. ~9 unit tests) | ~22 |
| 2 — Lobby pilot | 2 (tasks 24–25) | — (per-page review) | ~3 | 0 | 1 |
| **Total** | **25 + 2 gates** | | **21** | **~21** | **~23** |

Phase 1 lands a foundation that every page can inherit. Phase 2 validates it on Lobby. Phase 3+ (per-page work) gets new plans created as we discuss each page.

**Verification cadence:**
- Per-task: TS type-check + lint
- New-component tasks: + unit test alongside the component
- After Task 11 (Gate A): vitest full + e2e subset
- After Task 22 (Gate B): vitest full + e2e subset
- Task 23 (final smoke): full e2e suite + page walk
- Phase 2 (Task 25): user visual review

Total automated gates: **3** (Gate A, Gate B, Task 23). Manual review: **after every task** + final user review at Task 25.
