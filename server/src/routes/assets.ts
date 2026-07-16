import { Router, type Request, type Response } from "express";
import multer from "multer";
import type { Db } from "@armyofagents/db";
import { companies } from "@armyofagents/db";
import { eq } from "drizzle-orm";
import {
  COMPOSER_ATTACHMENT_CONTENT_TYPES,
  COMPOSER_MAX_ATTACHMENT_BYTES,
  createAssetImageMetadataSchema,
  createAssetFileMetadataSchema,
} from "@armyofagents/shared";
import type { StorageService } from "../storage/types.js";
import { assetService, logActivity } from "../services/index.js";
import { getSafeServingHeaders } from "../services/asset-serving-safety.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

const MAX_ASSET_IMAGE_BYTES = Number(process.env.AOA_ATTACHMENT_MAX_BYTES) || 10 * 1024 * 1024;
// General asset upload contract (artifacts, API consumers, uploadFileArtifact):
// all content types, documented AOA_FILE_MAX_BYTES default 50 MB. Composer
// restrictions must NOT narrow this shared route (PR #291 review) — they apply
// only to composer-namespaced uploads below.
const MAX_ASSET_FILE_BYTES = Number(process.env.AOA_FILE_MAX_BYTES) || 50 * 1024 * 1024;
const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);
// Unified-composer contract, enforced server-side only for uploads bound for a
// composer surface. The thread composer uploads under "discussion-entries"
// (ThreadTab.handleUpload) and Commander under "commander/<conversationId>"
// (InternalAgentPanel) — both validate client-side too; this is the
// defense-in-depth for well-formed composer clients without breaking the
// general asset route for everything else.
const COMPOSER_ALLOWED_FILE_CONTENT_TYPES = new Set<string>(COMPOSER_ATTACHMENT_CONTENT_TYPES);
function isComposerUploadNamespace(namespace: string): boolean {
  return namespace === "discussion-entries" || namespace.startsWith("commander/");
}

export function assetRoutes(db: Db, storage: StorageService) {
  const router = Router();
  const svc = assetService(db);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_ASSET_IMAGE_BYTES, files: 1 },
  });

  async function runSingleFileUpload(req: Request, res: Response) {
    await new Promise<void>((resolve, reject) => {
      upload.single("file")(req, res, (err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  router.post("/companies/:companyId/assets/images", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    try {
      await runSingleFileUpload(req, res);
    } catch (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(422).json({ error: `Image exceeds ${MAX_ASSET_IMAGE_BYTES} bytes` });
          return;
        }
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }

    const file = (req as Request & { file?: { mimetype: string; buffer: Buffer; originalname: string } }).file;
    if (!file) {
      res.status(400).json({ error: "Missing file field 'file'" });
      return;
    }

    const contentType = (file.mimetype || "").toLowerCase();
    if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
      res.status(422).json({ error: `Unsupported image type: ${contentType || "unknown"}` });
      return;
    }
    if (file.buffer.length <= 0) {
      res.status(422).json({ error: "Image is empty" });
      return;
    }

    const parsedMeta = createAssetImageMetadataSchema.safeParse(req.body ?? {});
    if (!parsedMeta.success) {
      res.status(400).json({ error: "Invalid image metadata", details: parsedMeta.error.issues });
      return;
    }

    const namespaceSuffix = parsedMeta.data.namespace ?? "general";
    const actor = getActorInfo(req);
    const stored = await storage.putFile({
      companyId,
      namespace: `assets/${namespaceSuffix}`,
      originalFilename: file.originalname || null,
      contentType,
      body: file.buffer,
    });

    const asset = await svc.create(companyId, {
      provider: stored.provider,
      objectKey: stored.objectKey,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      originalFilename: stored.originalFilename,
      createdByAgentId: actor.agentId,
      createdByUserId: actor.actorType === "user" ? actor.actorId : null,
    });

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "asset.created",
      entityType: "asset",
      entityId: asset.id,
      details: {
        originalFilename: asset.originalFilename,
        contentType: asset.contentType,
        byteSize: asset.byteSize,
      },
    });

    res.status(201).json({
      assetId: asset.id,
      companyId: asset.companyId,
      provider: asset.provider,
      objectKey: asset.objectKey,
      contentType: asset.contentType,
      byteSize: asset.byteSize,
      sha256: asset.sha256,
      originalFilename: asset.originalFilename,
      createdByAgentId: asset.createdByAgentId,
      createdByUserId: asset.createdByUserId,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
      contentPath: `/api/assets/${asset.id}/content`,
    });
  });

  // ── General file upload (all types, 50MB) ─────────────────────────────
  const fileUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_ASSET_FILE_BYTES, files: 1 },
  });

  async function runSingleFileUploadLarge(req: Request, res: Response) {
    await new Promise<void>((resolve, reject) => {
      fileUpload.single("file")(req, res, (err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  router.post("/companies/:companyId/assets/files", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    try {
      await runSingleFileUploadLarge(req, res);
    } catch (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(422).json({ error: `File exceeds ${MAX_ASSET_FILE_BYTES} bytes` });
          return;
        }
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }

    const file = (req as Request & { file?: { mimetype: string; buffer: Buffer; originalname: string } }).file;
    if (!file) {
      res.status(400).json({ error: "Missing file field 'file'" });
      return;
    }
    if (file.buffer.length <= 0) {
      res.status(422).json({ error: "File is empty" });
      return;
    }

    const parsedMeta = createAssetFileMetadataSchema.safeParse(req.body ?? {});
    if (!parsedMeta.success) {
      res.status(400).json({ error: "Invalid file metadata", details: parsedMeta.error.issues });
      return;
    }

    const namespaceSuffix = parsedMeta.data.namespace ?? "files";
    const contentType = (file.mimetype || "application/octet-stream").toLowerCase();
    if (isComposerUploadNamespace(namespaceSuffix)) {
      if (!COMPOSER_ALLOWED_FILE_CONTENT_TYPES.has(contentType)) {
        res.status(415).json({ error: `Unsupported attachment type: ${contentType}` });
        return;
      }
      if (file.buffer.length > COMPOSER_MAX_ATTACHMENT_BYTES) {
        res.status(422).json({ error: `Attachment exceeds ${COMPOSER_MAX_ATTACHMENT_BYTES} bytes` });
        return;
      }
    }
    const actor = getActorInfo(req);
    const stored = await storage.putFile({
      companyId,
      namespace: `assets/${namespaceSuffix}`,
      originalFilename: file.originalname || null,
      contentType,
      body: file.buffer,
    });

    const asset = await svc.create(companyId, {
      provider: stored.provider,
      objectKey: stored.objectKey,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      originalFilename: stored.originalFilename,
      createdByAgentId: actor.agentId,
      createdByUserId: actor.actorType === "user" ? actor.actorId : null,
    });

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "asset.created",
      entityType: "asset",
      entityId: asset.id,
      details: {
        originalFilename: asset.originalFilename,
        contentType: asset.contentType,
        byteSize: asset.byteSize,
      },
    });

    res.status(201).json({
      assetId: asset.id,
      companyId: asset.companyId,
      provider: asset.provider,
      objectKey: asset.objectKey,
      contentType: asset.contentType,
      byteSize: asset.byteSize,
      sha256: asset.sha256,
      originalFilename: asset.originalFilename,
      createdByAgentId: asset.createdByAgentId,
      createdByUserId: asset.createdByUserId,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
      contentPath: `/api/assets/${asset.id}/content`,
    });
  });

  // ── Logo upload ─────────────────────────────────────────────────────
  router.post("/companies/:companyId/logo", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    try {
      await runSingleFileUpload(req, res);
    } catch (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(422).json({ error: `Logo exceeds ${MAX_ASSET_IMAGE_BYTES} bytes` });
          return;
        }
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }

    const file = (req as Request & { file?: { mimetype: string; buffer: Buffer; originalname: string } }).file;
    if (!file) {
      res.status(400).json({ error: "Missing file field 'file'" });
      return;
    }

    const contentType = (file.mimetype || "").toLowerCase();
    if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
      res.status(422).json({ error: `Unsupported image type: ${contentType || "unknown"}` });
      return;
    }
    if (file.buffer.length <= 0) {
      res.status(422).json({ error: "Image is empty" });
      return;
    }

    const actor = getActorInfo(req);
    const stored = await storage.putFile({
      companyId,
      namespace: "assets/logos",
      originalFilename: file.originalname || null,
      contentType,
      body: file.buffer,
    });

    const asset = await svc.create(companyId, {
      provider: stored.provider,
      objectKey: stored.objectKey,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      originalFilename: stored.originalFilename,
      createdByAgentId: actor.agentId,
      createdByUserId: actor.actorType === "user" ? actor.actorId : null,
    });

    await db.update(companies).set({ logoAssetId: asset.id }).where(eq(companies.id, companyId));

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "company.logo_updated",
      entityType: "company",
      entityId: companyId,
      details: { assetId: asset.id, originalFilename: asset.originalFilename },
    });

    res.status(200).json({
      logoAssetId: asset.id,
      logoUrl: `/api/assets/${asset.id}/content`,
    });
  });

  router.delete("/companies/:companyId/logo", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    await db.update(companies).set({ logoAssetId: null }).where(eq(companies.id, companyId));

    res.status(200).json({ ok: true });
  });

  router.get("/assets/:assetId/content", async (req, res, next) => {
    const assetId = req.params.assetId as string;
    const asset = await svc.getById(assetId);
    if (!asset) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }
    assertCompanyAccess(req, asset.companyId);

    const object = await storage.getObject(asset.companyId, asset.objectKey);
    const safe = getSafeServingHeaders(
      asset.contentType || object.contentType,
      asset.originalFilename,
    );
    res.setHeader("Content-Type", safe.contentType);
    res.setHeader("Content-Length", String(asset.byteSize || object.contentLength || 0));
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("Content-Disposition", safe.contentDisposition);
    res.setHeader("X-Content-Type-Options", safe.xContentTypeOptions);

    object.stream.on("error", (err) => {
      next(err);
    });
    object.stream.pipe(res);
  });

  return router;
}

