/**
 * File Import Service — Phase 4.5
 *
 * Two-stage pipeline:
 *   Stage 1: extractTextFromBuffer — format-specific text extraction
 *   Stage 2: extractItemsFromText  — LLM extraction or paragraph chunking
 *
 * TODO: Commander sub-agent extraction — when the Commander sub-agent
 * architecture lands for Discussions, swap extractItemsFromText() here.
 * processorType will be "commander_extraction" in that path.
 */

import { and, eq, isNull, lte, or } from "drizzle-orm";
import type { Readable } from "node:stream";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import type { Db } from "@armyofagents/db";
import { fileImportJobs, memoryItems } from "@armyofagents/db";
import type { StorageService } from "../storage/types.js";
import { extractionService } from "./extraction.js";

// ── Constants ─────────────────────────────────────────────────────────────

export const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
] as const;

export type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

export const WORKER_BATCH_SIZE = 3;
export const WORKER_INTERVAL_MS = 15_000;
export const MAX_RETRIES = 3;
export const RETRY_BACKOFF_MS = [15_000, 60_000, 240_000] as const;

// Chunking constants
const CHUNK_MIN_CHARS = 30;
const CHUNK_MERGE_THRESHOLD = 100;
const CHUNK_SPLIT_THRESHOLD = 1500;
const CHUNK_MAX_CHARS = 2000;
const TITLE_MAX_CHARS = 80;

// ── Helpers ───────────────────────────────────────────────────────────────

export async function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

// ── Stage 1: Text extraction ──────────────────────────────────────────────

export interface TextExtractionResult {
  text: string;
  warnings: string[];
}

export async function extractTextFromBuffer(
  buffer: Buffer,
  mimeType: string,
): Promise<TextExtractionResult> {
  switch (mimeType) {
    case "text/plain":
      return { text: buffer.toString("utf-8"), warnings: [] };

    case "application/pdf": {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      return { text: result.text, warnings: [] };
    }

    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
      // Use convertToHtml (not extractRawText) to preserve heading structure
      // in memory during extraction. HTML is used transiently; only the
      // warning strings are persisted to the job's parserWarnings column.
      const result = await mammoth.convertToHtml({ buffer });
      const text = result.value
        .replace(/<[^>]+>/g, "\n")       // strip HTML tags → newlines
        .replace(/\n{3,}/g, "\n\n")       // collapse 3+ newlines to 2
        .trim();
      const warnings = result.messages.map((m) => m.message);
      return { text, warnings };
    }

    default:
      throw new Error(`Unsupported MIME type: ${mimeType}`);
  }
}
