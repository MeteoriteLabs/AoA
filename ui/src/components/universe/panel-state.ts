export type Rect = { x: number; y: number; width: number; height: number };
export type Scope = {
  companyId: string;
  userId: string;
  conversationId: string;
};
export type Ref = {
  companyId: string;
  kind: "task" | "artifact" | "browser";
  id: string;
  version?: string;
};
export type Panel = {
  key: string;
  generation: number;
  openedOrdinal: number;
  ref: Ref;
  title: string;
  rect: Rect;
  minimized: boolean;
  pinned: boolean;
};
export type State = {
  /** Reconciliation watermark only; persistence authority remains with E1.2. */
  layoutRevision?: number;
  scope: Scope;
  nextGeneration: number;
  nextOpenedOrdinal: number;
  panels: Record<string, Panel>;
  order: string[];
  selected: string | null;
  maximized: string | null;
};
export type Action =
  | { type: "open"; ref: Ref; title: string; rect: Rect }
  | {
      type: "focus" | "minimize" | "restore" | "maximize" | "close";
      key: string;
      generation: number;
    }
  | { type: "pin"; key: string; generation: number; value: boolean }
  | {
      type: "geometry";
      key: string;
      generation: number;
      rect: Rect;
      source: "human" | "commander";
      expectedRect?: Rect;
    };

export const panelKey = (scope: Scope, ref: Ref): string =>
  JSON.stringify([
    scope.companyId,
    scope.userId,
    scope.conversationId,
    ref.kind,
    ref.id,
    ref.version ?? null,
  ]);

export const initialState = (scope: Scope): State => ({
  scope: { ...scope },
  nextGeneration: 1,
  nextOpenedOrdinal: 1,
  panels: {},
  order: [],
  selected: null,
  maximized: null,
});

export const validRect = (r: Rect): boolean =>
  !!r &&
  [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
  Math.abs(r.x) <= 1e6 &&
  Math.abs(r.y) <= 1e6 &&
  r.width >= 1 &&
  r.height >= 1 &&
  r.width <= 8192 &&
  r.height <= 8192;

function foreground(s: State, key: string): State {
  return {
    ...s,
    selected: key,
    order: [...s.order.filter((k) => k !== key), key],
    maximized: s.maximized === key ? key : null,
  };
}
function nextVisible(s: State): string | null {
  return [...s.order].reverse().find((k) => !s.panels[k].minimized) ?? null;
}

export function panelReducer(s: State, a: Action): State {
  if (a.type === "open") {
    if (
      !validRef(a.ref, s.scope) ||
      typeof a.title !== "string" ||
      !validRect(a.rect)
    )
      return s;
    const key = panelKey(s.scope, a.ref);
    const existing = Object.hasOwn(s.panels, key) ? s.panels[key] : undefined;
    if (
      !existing &&
      (!allocatable(s.nextOpenedOrdinal) || !allocatable(s.nextGeneration))
    )
      return s;
    const panel: Panel = existing
      ? { ...existing, minimized: false }
      : {
          key,
          generation: s.nextGeneration,
          openedOrdinal: s.nextOpenedOrdinal,
          ref: { ...a.ref },
          title: a.title,
          rect: { ...a.rect },
          minimized: false,
          pinned: false,
        };
    return foreground(
      {
        ...s,
        nextGeneration: existing ? s.nextGeneration : s.nextGeneration + 1,
        nextOpenedOrdinal: existing
          ? s.nextOpenedOrdinal
          : s.nextOpenedOrdinal + 1,
        panels: { ...s.panels, [key]: panel },
      },
      key
    );
  }
  const panel = Object.hasOwn(s.panels, a.key) ? s.panels[a.key] : undefined;
  if (
    !panel ||
    !positiveInteger(a.generation) ||
    panel.generation !== a.generation
  )
    return s;
  switch (a.type) {
    case "geometry":
      if (
        a.expectedRect !== undefined &&
        (!validRect(a.expectedRect) || !equalRect(panel.rect, a.expectedRect))
      )
        return s;
      if (
        (a.source !== "human" && a.source !== "commander") ||
        panel.minimized ||
        s.maximized === a.key ||
        (panel.pinned && a.source === "commander") ||
        !validRect(a.rect)
      )
        return s;
      return {
        ...s,
        panels: { ...s.panels, [a.key]: { ...panel, rect: { ...a.rect } } },
      };
    case "pin":
      if (typeof a.value !== "boolean") return s;
      return {
        ...s,
        panels: { ...s.panels, [a.key]: { ...panel, pinned: a.value } },
      };
    case "focus":
      return panel.minimized ? s : foreground(s, a.key);
    case "maximize": {
      const next = foreground(
        {
          ...s,
          panels: { ...s.panels, [a.key]: { ...panel, minimized: false } },
        },
        a.key
      );
      return { ...next, maximized: a.key };
    }
    case "restore": {
      const next = foreground(
        {
          ...s,
          panels: { ...s.panels, [a.key]: { ...panel, minimized: false } },
        },
        a.key
      );
      return { ...next, maximized: null };
    }
    case "minimize": {
      const next: State = {
        ...s,
        panels: { ...s.panels, [a.key]: { ...panel, minimized: true } },
        maximized: s.maximized === a.key ? null : s.maximized,
      };
      return {
        ...next,
        selected: s.selected === a.key ? nextVisible(next) : s.selected,
      };
    }
    case "close": {
      const panels = { ...s.panels };
      delete panels[a.key];
      const next: State = {
        ...s,
        panels,
        order: s.order.filter((k) => k !== a.key),
        maximized: s.maximized === a.key ? null : s.maximized,
      };
      return {
        ...next,
        selected: s.selected === a.key ? nextVisible(next) : s.selected,
      };
    }
  }
  return s;
}

export type Viewport = { x: number; y: number; zoom: number };
export type Bounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};
function validateView(view: Viewport, usable: Bounds): void {
  if (
    ![
      view.x,
      view.y,
      view.zoom,
      usable.left,
      usable.top,
      usable.width,
      usable.height,
    ].every(Number.isFinite) ||
    view.zoom < 0.25 ||
    view.zoom > 2 ||
    usable.width <= 0 ||
    usable.height <= 0
  )
    throw new RangeError("Unavailable or invalid canvas viewport");
}
export function displayRect(
  panel: Panel,
  state: State,
  view: Viewport,
  usable: Bounds
): Rect {
  validateView(view, usable);
  if (state.maximized !== panel.key) return panel.rect;
  return {
    x: (usable.left - view.x) / view.zoom,
    y: (usable.top - view.y) / view.zoom,
    width: usable.width / view.zoom,
    height: usable.height / view.zoom,
  };
}
export type SizePolicy = {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
};
export function openingRect(
  policy: SizePolicy,
  usable: Bounds,
  view: Viewport,
  ordinal: number
): Rect {
  validateView(view, usable);
  if (
    ![policy.width, policy.height, policy.minWidth, policy.minHeight].every(
      (n) => Number.isFinite(n) && n > 0
    ) ||
    !Number.isSafeInteger(ordinal) ||
    ordinal < 0
  )
    throw new RangeError("Invalid opening policy");
  // Desired sizes are CSS pixels at the current zoom, converted to canvas units once.
  const width = Math.min(policy.width, usable.width);
  const height = Math.min(policy.height, usable.height);
  const dx = Math.min(
    (ordinal % 4) * 20,
    Math.max(0, (usable.width - width) / 2)
  );
  const dy = Math.min(
    (ordinal % 4) * 20,
    Math.max(0, (usable.height - height) / 2)
  );
  return {
    x: (usable.left + (usable.width - width) / 2 + dx - view.x) / view.zoom,
    y: (usable.top + (usable.height - height) / 2 + dy - view.y) / view.zoom,
    width: width / view.zoom,
    height: height / view.zoom,
  };
}

export const positiveInteger = (n: number): boolean =>
  Number.isSafeInteger(n) && n > 0;
export const equalRect = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const allocatable = (n: number): boolean =>
  positiveInteger(n) && n < Number.MAX_SAFE_INTEGER;
const nonempty = (s: unknown): s is string =>
  typeof s === "string" && s.trim().length > 0;
export const validScope = (s: Scope): boolean =>
  !!s &&
  nonempty(s.companyId) &&
  nonempty(s.userId) &&
  nonempty(s.conversationId);
export const sameScope = (a: Scope, b: Scope): boolean =>
  validScope(a) &&
  validScope(b) &&
  a.companyId === b.companyId &&
  a.userId === b.userId &&
  a.conversationId === b.conversationId;
export const validRef = (r: Ref, scope: Scope): boolean =>
  !!r &&
  r.companyId === scope.companyId &&
  ["task", "artifact", "browser"].includes(r.kind) &&
  nonempty(r.id) &&
  (r.version === undefined || nonempty(r.version));

export {
  hydrateLayout,
  viewportFromLayout,
  reconcileOpeningAck,
} from "./panel-layout";
export type {
  AuthorizedLayoutSnapshot,
  PendingOpen,
  OpeningAck,
} from "./panel-layout";
