import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { Readable } from "node:stream";
import { memoryAssetRenderRoutes } from "../routes/memory-asset-render.js";

vi.mock("../routes/authz.js", () => ({
  assertCompanyAccess: () => undefined,
}));

// Stub the service module to break the drizzle-orm ESM cycle
vi.mock("../services/memory-assets.js", () => ({
  memoryAssetsService: vi.fn(() => ({})),
}));

vi.mock("mammoth", () => ({
  default: {
    convertToHtml: vi.fn(async () => ({ value: "<p>hello world</p>", messages: [] })),
  },
}));

function buildApp(svc: unknown, storage: unknown) {
  const app = express();
  app.use(express.json());
  app.use(memoryAssetRenderRoutes({ svc: svc as never, storage: storage as never }));
  return app;
}

describe("memory-asset render route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders DOCX to HTML", async () => {
    const svc = {
      get: vi.fn(async () => ({
        id: "a-1",
        fileName: "doc.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        storageKey: "co-1/imports/a-1.docx",
      })),
    };
    const storage = {
      getObject: vi.fn(async () => ({
        stream: Readable.from([Buffer.from("dummy docx bytes")]),
        contentLength: 16,
      })),
    };
    const app = buildApp(svc, storage);
    const res = await request(app).get("/companies/co-1/memory/assets/a-1/render");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("hello world");
  });

  it("returns 415 for unsupported mime types", async () => {
    const svc = {
      get: vi.fn(async () => ({
        id: "a-1",
        fileName: "x.png",
        mimeType: "image/png",
        storageKey: "k",
      })),
    };
    const storage = { getObject: vi.fn() };
    const app = buildApp(svc, storage);
    const res = await request(app).get("/companies/co-1/memory/assets/a-1/render");
    expect(res.status).toBe(415);
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it("returns 404 when asset doesn't exist", async () => {
    const svc = { get: vi.fn(async () => null) };
    const storage = { getObject: vi.fn() };
    const app = buildApp(svc, storage);
    const res = await request(app).get("/companies/co-1/memory/assets/missing/render");
    expect(res.status).toBe(404);
  });
});
