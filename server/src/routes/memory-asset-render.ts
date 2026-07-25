import { Router, type Request, type Response } from "express";
import type { Db } from "@armyofagents/db";
import { memoryAssetsService } from "../services/memory-assets.js";
import type { StorageService } from "../storage/types.js";
import { assertCompanyAccess } from "./authz.js";
import { DOCX_MIME, streamToBuffer, renderDocxBufferToSafeHtml } from "../services/docx-render.js";

interface RoutesOptions {
  db?: Db;
  svc?: ReturnType<typeof memoryAssetsService>;
  storage?: { getObject: (companyId: string, key: string) => Promise<{ stream: NodeJS.ReadableStream; contentLength: number }> };
  storageService?: StorageService;
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
        // Shared convert+sanitize+wrap (server/src/services/docx-render.ts) —
        // single source with the generic /assets/:id/render route so the two
        // surfaces never drift in security posture.
        const html = await renderDocxBufferToSafeHtml(buffer);

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.send(html);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
