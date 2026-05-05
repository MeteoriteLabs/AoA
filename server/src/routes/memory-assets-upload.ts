import path from "node:path";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import type { Db } from "@armyofagents/db";
import { SUPPORTED_MIME_TYPES } from "../services/file-import.js";
import { memoryAssetsService } from "../services/memory-assets.js";
import type { StorageService } from "../storage/types.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { assertRole } from "../middleware/rbac.js";

const SUPPORTED_UPLOAD_MIME_TYPES_SET = new Set<string>([
  ...SUPPORTED_MIME_TYPES,
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const MAX_FILE_SIZE_BYTES =
  Number(process.env.AOA_FILE_MAX_BYTES) || 50 * 1024 * 1024;

interface RoutesOptions {
  db?: Db;
  assetsService?: ReturnType<typeof memoryAssetsService>;
  storage?: { putFile: (input: unknown) => Promise<{ objectKey: string; byteSize: number; sha256: string }> };
  storageService?: StorageService;
}

export function memoryAssetsUploadRoutes(opts: RoutesOptions) {
  const router = Router();
  const assets = opts.assetsService ?? memoryAssetsService(opts.db!);
  const storage = opts.storage ?? opts.storageService;

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  });

  function runSingle(req: Request, res: Response): Promise<void> {
    return new Promise((resolve, reject) => {
      upload.single("file")(req, res, (err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  router.post(
    "/companies/:companyId/memory/assets/upload",
    async (req, res, next) => {
      try {
        const companyId = req.params.companyId as string;
        assertCompanyAccess(req, companyId);
        if (opts.db) await assertRole(opts.db, req, companyId, "team_lead");

        try {
          await runSingle(req, res);
        } catch (err) {
          if (err instanceof multer.MulterError) {
            if (err.code === "LIMIT_FILE_SIZE") {
              res.status(422).json({ error: `File exceeds ${MAX_FILE_SIZE_BYTES} bytes` });
              return;
            }
            res.status(400).json({ error: err.message });
            return;
          }
          throw err;
        }

        const file = (req as Request & { file?: { mimetype: string; buffer: Buffer; originalname: string; size: number } }).file;
        if (!file) {
          res.status(400).json({ error: "No file uploaded" });
          return;
        }

        if (!SUPPORTED_UPLOAD_MIME_TYPES_SET.has(file.mimetype)) {
          res.status(400).json({
            error: `Unsupported file type: ${file.mimetype}`,
          });
          return;
        }

        const { departmentId, folderPath } = req.body as Record<string, string | undefined>;

        if (!storage) {
          res.status(500).json({ error: "Storage not configured" });
          return;
        }

        const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
        const namespace = `imports/${Date.now()}-${safeName}`;
        const stored = await storage.putFile({
          companyId,
          namespace,
          originalFilename: file.originalname,
          contentType: file.mimetype,
          body: file.buffer,
        });

        const actor = getActorInfo(req);
        // Phase 6.1c: actorId is "local-board" in local_trusted mode (synthetic
        // actor, not a UUID). The uploaded_by_user_id column is UUID-typed —
        // only set it when the actor really is a user (UUID-shaped).
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const userId = actor.actorId && UUID_RE.test(actor.actorId) ? actor.actorId : null;

        // Phase 6.2e: uploads create assets only — no auto-extraction. The
        // founder (or a future Commander sub-agent) is responsible for
        // turning files into curated memory items via an explicit action.
        const asset = await assets.create({
          companyId,
          departmentId: departmentId ?? null,
          folderPath: folderPath ?? "",
          fileName: file.originalname,
          mimeType: file.mimetype,
          fileSize: file.size,
          storageKey: stored.objectKey,
          importJobId: null,
          uploadedByUserId: userId,
        });

        res.status(201).json({ asset });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
