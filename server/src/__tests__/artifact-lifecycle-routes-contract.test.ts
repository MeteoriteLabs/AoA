import { describe, expect, it } from "vitest";
import type { Router } from "express";
import { artifactRoutes } from "../routes/artifacts.js";
import { assetRoutes } from "../routes/assets.js";
import { discussionRoutes } from "../routes/discussions.js";

function extractRoutes(router: Router): Array<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = [];
  const layers: Array<{ route?: { path: string; methods: Record<string, boolean> } }> =
    (router as unknown as { stack?: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack ?? [];
  for (const layer of layers) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      routes.push({ method: method.toUpperCase(), path: layer.route.path });
    }
  }
  return routes;
}

function hasRoute(routes: Array<{ method: string; path: string }>, method: string, path: string) {
  return routes.some((route) => route.method === method && route.path === path);
}

describe("artifact lifecycle route contracts", () => {
  it("exposes artifact archive and delete endpoints", () => {
    const routes = extractRoutes(artifactRoutes({} as never));

    expect(hasRoute(routes, "POST", "/artifacts/:id/archive")).toBe(true);
    expect(hasRoute(routes, "DELETE", "/artifacts/:id")).toBe(true);
  });

  it("exposes asset delete endpoint", () => {
    const storage = {
      provider: "local",
      putFile: async () => {
        throw new Error("not used");
      },
      getObject: async () => {
        throw new Error("not used");
      },
      headObject: async () => {
        throw new Error("not used");
      },
      deleteObject: async () => undefined,
    };
    const routes = extractRoutes(assetRoutes({} as never, storage as never));

    expect(hasRoute(routes, "DELETE", "/assets/:assetId")).toBe(true);
  });

  it("exposes discussion attachment removal endpoint", () => {
    const routes = extractRoutes(discussionRoutes({} as never));

    expect(
      hasRoute(
        routes,
        "DELETE",
        "/companies/:companyId/discussions/:discussionId/attachments/:attachmentId",
      ),
    ).toBe(true);
  });
});
