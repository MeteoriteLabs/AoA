/**
 * POST /companies/:companyId/assets/files — upload contract (PR #291 review).
 *
 * `/assets/files` is the GENERAL asset upload route (artifacts, API consumers,
 * `uploadFileArtifact` composition): all content types, AOA_FILE_MAX_BYTES
 * (default 50 MB). The unified-composer branch must NOT narrow that shared
 * contract. Composer restrictions (COMPOSER_ATTACHMENT_CONTENT_TYPES + 10 MB)
 * apply only to composer-namespaced uploads ("discussion-entries",
 * "commander/*"), which is where the thread + Commander composers send files.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";

const companyId = "11111111-1111-4111-8111-111111111111";

const mockAssetService = vi.hoisted(() => ({
  create: vi.fn(),
  getById: vi.fn(),
}));
const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  assetService: () => mockAssetService,
  logActivity: mockLogActivity,
}));

const { assetRoutes } = await import("../routes/assets.js");

function createApp() {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: true,
      companyIds: [companyId],
    };
    next();
  });
  app.use(
    "/api",
    assetRoutes({} as any, {
      putFile: vi.fn(async (input: { originalFilename: string | null; contentType: string; body: Buffer }) => ({
        provider: "memory",
        objectKey: `stored/${input.originalFilename ?? "file"}`,
        contentType: input.contentType,
        byteSize: input.body.length,
        sha256: "sha256",
        originalFilename: input.originalFilename,
      })),
      getObject: vi.fn(),
      deleteObject: vi.fn(),
    } as any),
  );
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAssetService.create.mockImplementation(async (_companyId: string, input: Record<string, unknown>) => ({
    id: "asset-1",
    companyId,
    ...input,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }));
});

describe("POST /companies/:companyId/assets/files — general contract", () => {
  it("accepts a DOCX (non-composer type) without a namespace — the artifact upload path", async () => {
    const res = await request(createApp())
      .post(`/api/companies/${companyId}/assets/files`)
      .attach("file", Buffer.from("PK-docx"), {
        filename: "spec.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

    expect(res.status).toBe(201);
    expect(res.body.assetId).toBe("asset-1");
  });

  it("accepts a ZIP into a non-composer namespace", async () => {
    const res = await request(createApp())
      .post(`/api/companies/${companyId}/assets/files`)
      .field("namespace", "artifacts")
      .attach("file", Buffer.from("PK-zip"), { filename: "bundle.zip", contentType: "application/zip" });

    expect(res.status).toBe(201);
  });

  it("accepts a general upload larger than the 10 MB composer cap (documented 50 MB route limit)", async () => {
    const elevenMb = Buffer.alloc(11 * 1024 * 1024, 1);
    const res = await request(createApp())
      .post(`/api/companies/${companyId}/assets/files`)
      .attach("file", elevenMb, { filename: "video.mp4", contentType: "video/mp4" });

    expect(res.status).toBe(201);
  });
});

describe("POST /companies/:companyId/assets/files — composer-namespaced guard", () => {
  it("rejects a non-allowlisted type in the discussion composer namespace (415)", async () => {
    const res = await request(createApp())
      .post(`/api/companies/${companyId}/assets/files`)
      .field("namespace", "discussion-entries")
      .attach("file", Buffer.from("a,b,c"), { filename: "data.csv", contentType: "text/csv" });

    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/unsupported attachment type/i);
    expect(mockAssetService.create).not.toHaveBeenCalled();
  });

  it("rejects a non-allowlisted type in a Commander conversation namespace (415)", async () => {
    const res = await request(createApp())
      .post(`/api/companies/${companyId}/assets/files`)
      .field("namespace", "commander/conv-1")
      .attach("file", Buffer.from("PK-zip"), { filename: "bundle.zip", contentType: "application/zip" });

    expect(res.status).toBe(415);
  });

  it("rejects a composer upload above the 10 MB composer cap (422)", async () => {
    const elevenMb = Buffer.alloc(11 * 1024 * 1024, 1);
    const res = await request(createApp())
      .post(`/api/companies/${companyId}/assets/files`)
      .field("namespace", "discussion-entries")
      .attach("file", elevenMb, { filename: "big.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(422);
    expect(mockAssetService.create).not.toHaveBeenCalled();
  });

  it("accepts an allowlisted type within the cap in the composer namespace", async () => {
    const res = await request(createApp())
      .post(`/api/companies/${companyId}/assets/files`)
      .field("namespace", "discussion-entries")
      .attach("file", Buffer.from("%PDF-1.4"), { filename: "brief.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(201);
  });
});
