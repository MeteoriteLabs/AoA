import { Router, type Request, type Response } from "express";
import multer from "multer";
import type { Db } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import { transcribe } from "../services/transcription.js";
import { secretService } from "../services/index.js";
import { logger } from "../middleware/logger.js";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25MB — Whisper API limit

const ALLOWED_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/wav",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/flac",
  "audio/x-m4a",
  "audio/mp3",
  "video/webm", // MediaRecorder sometimes uses video/webm for audio
]);

export function transcriptionRoutes(db: Db) {
  const router = Router();
  const secrets = secretService(db);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
  });

  async function runSingleFileUpload(req: Request, res: Response) {
    await new Promise<void>((resolve, reject) => {
      upload.single("file")(req, res, (err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  router.post("/companies/:companyId/transcribe", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const log = logger.child({ route: "transcribe", companyId });

    // Parse multipart upload
    try {
      await runSingleFileUpload(req, res);
    } catch (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(422).json({ error: `Audio file exceeds ${MAX_AUDIO_BYTES} bytes` });
          return;
        }
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }

    const file = (req as Request & { file?: { mimetype: string; buffer: Buffer; originalname: string } }).file;
    if (!file) {
      res.status(400).json({ error: "Missing audio file field 'file'" });
      return;
    }

    const contentType = (file.mimetype || "").toLowerCase();
    if (!ALLOWED_AUDIO_TYPES.has(contentType)) {
      res.status(422).json({ error: `Unsupported audio type: ${contentType || "unknown"}` });
      return;
    }

    if (file.buffer.length <= 0) {
      res.status(422).json({ error: "Audio file is empty" });
      return;
    }

    // Resolve OpenAI API key: try company secret first, then env var
    let apiKey: string | null = null;
    try {
      apiKey = await secrets.resolveByName(companyId, "llm:openai");
    } catch {
      // Secret not found — fall back to env var
    }
    if (!apiKey) {
      apiKey = process.env.OPENAI_API_KEY?.trim() ?? null;
    }
    if (!apiKey) {
      res.status(422).json({
        error: "Voice transcription requires an OpenAI API key. Add one in Settings → LLM Providers.",
      });
      return;
    }

    try {
      const text = await transcribe(file.buffer, contentType, apiKey);
      res.json({ text });
    } catch (err) {
      log.error({ err }, "Transcription failed");
      const message = err instanceof Error ? err.message : "Transcription failed";
      if (message.includes("empty transcription")) {
        res.status(422).json({ error: "Could not transcribe audio. The recording may be empty or inaudible." });
        return;
      }
      res.status(500).json({ error: "Transcription failed. Please try again." });
    }
  });

  return router;
}
