import { createHash } from "node:crypto";
import type { LayoutOp, UniverseLayoutDocument } from "@armyofagents/shared";
import { badRequest } from "../errors.js";

// Pure document reducer — deliberately free of any @armyofagents/db import so it
// can be unit-tested directly without the drizzle-orm ESM require cycle. The
// stateful, DB-backed service in universe-layout.ts consumes these.

export type UniverseScope = {
  companyId: string;
  userId: string;
  conversationId: string;
};

/** Deterministic hash of a patch's operations, for idempotent receipts. A client
 * that resends the identical patch (same operationId) hashes to the same value; a
 * changed payload under a reused operationId hashes differently and conflicts. */
export function hashLayoutOperations(operations: LayoutOp[]): string {
  return createHash("sha256").update(JSON.stringify(operations)).digest("hex");
}

function foreground(
  doc: UniverseLayoutDocument,
  key: string,
): UniverseLayoutDocument {
  return {
    ...doc,
    order: [...doc.order.filter((k) => k !== key), key],
    selected: key,
  };
}

/** Pure reducer: apply one operation to the presentation document. Throws
 * badRequest (400) for an operation referencing a panel that does not exist, or
 * an order that is not a permutation of the open panels — never silent creation. */
export function applyLayoutOp(
  doc: UniverseLayoutDocument,
  op: LayoutOp,
  scope: UniverseScope,
): UniverseLayoutDocument {
  switch (op.type) {
    case "open": {
      const existing = doc.panels.some((p) => p.key === op.key);
      if (existing)
        return foreground(
          {
            ...doc,
            panels: doc.panels.map((p) =>
              p.key === op.key ? { ...p, minimized: false } : p,
            ),
          },
          op.key,
        );
      return foreground(
        {
          ...doc,
          panels: [
            ...doc.panels,
            {
              key: op.key,
              ref: { companyId: scope.companyId, ...op.ref },
              title: op.title,
              rect: op.rect,
              openedOrdinal: doc.nextOpenedOrdinal,
              minimized: false,
              pinned: false,
              placement: "auto" as const,
            },
          ],
          nextOpenedOrdinal: doc.nextOpenedOrdinal + 1,
        },
        op.key,
      );
    }
    case "geometry":
    case "pin":
    case "minimize": {
      if (!doc.panels.some((p) => p.key === op.key))
        throw badRequest(`Unknown panel for ${op.type}`);
      const panels = doc.panels.map((p) => {
        if (p.key !== op.key) return p;
        if (op.type === "geometry") return { ...p, rect: op.rect };
        if (op.type === "pin") return { ...p, pinned: op.value };
        return { ...p, minimized: op.value };
      });
      if (op.type === "minimize" && op.value)
        return {
          ...doc,
          panels,
          selected: doc.selected === op.key ? null : doc.selected,
          maximized: doc.maximized === op.key ? null : doc.maximized,
        };
      return { ...doc, panels };
    }
    case "close": {
      if (!doc.panels.some((p) => p.key === op.key))
        throw badRequest("Unknown panel for close");
      return {
        ...doc,
        panels: doc.panels.filter((p) => p.key !== op.key),
        order: doc.order.filter((k) => k !== op.key),
        selected: doc.selected === op.key ? null : doc.selected,
        maximized: doc.maximized === op.key ? null : doc.maximized,
      };
    }
    case "order": {
      const keys = new Set(doc.panels.map((p) => p.key));
      if (
        op.keys.length !== keys.size ||
        new Set(op.keys).size !== op.keys.length ||
        op.keys.some((k) => !keys.has(k))
      )
        throw badRequest("Order must be a permutation of the open panels");
      return { ...doc, order: [...op.keys] };
    }
    case "viewport":
      return { ...doc, viewport: { x: op.x, y: op.y, zoom: op.zoom } };
  }
}

/** Fold a bounded batch of operations onto a document. */
export function applyLayoutOperations(
  doc: UniverseLayoutDocument,
  operations: LayoutOp[],
  scope: UniverseScope,
): UniverseLayoutDocument {
  return operations.reduce((acc, op) => applyLayoutOp(acc, op, scope), doc);
}
