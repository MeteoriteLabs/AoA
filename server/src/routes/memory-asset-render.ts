import { Router, type Request, type Response } from "express";
import mammoth from "mammoth";
import type { Db } from "@armyofagents/db";
import { memoryAssetsService } from "../services/memory-assets.js";
import type { StorageService } from "../storage/types.js";
import { assertCompanyAccess } from "./authz.js";

interface RoutesOptions {
  db?: Db;
  svc?: ReturnType<typeof memoryAssetsService>;
  storage?: { getObject: (companyId: string, key: string) => Promise<{ stream: NodeJS.ReadableStream; contentLength: number }> };
  storageService?: StorageService;
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

export function memoryAssetRenderRoutes(opts: RoutesOptions) {
  const router = Router();
  const svc = opts.svc ?? memoryAssetsService(opts.db!);
  const storage = opts.storage ?? opts.storageService;

  router.get(
    "/companies/:companyId/memory/assets/:id/render",
    async (req: Request, res: Response, next) => {
      try {
        const companyId = req.params.companyId as string;
        const id = req.params.id as string;
        assertCompanyAccess(req, companyId);

        const asset = await svc.get(id, companyId);
        if (!asset) {
          res.status(404).json({ error: "Asset not found" });
          return;
        }

        if (asset.mimeType !== DOCX_MIME) {
          res.status(415).json({
            error: `Render not supported for ${asset.mimeType}. Try /content for the raw bytes.`,
          });
          return;
        }

        if (!storage) {
          res.status(500).json({ error: "Storage not configured" });
          return;
        }

        const obj = await storage.getObject(companyId, asset.storageKey);
        const buffer = await streamToBuffer(obj.stream);
        const result = await mammoth.convertToHtml({ buffer });

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.send(`<article class="docx-rendered">${result.value}</article>`);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
