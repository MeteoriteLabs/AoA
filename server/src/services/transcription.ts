import { logger } from "../middleware/logger.js";

const WHISPER_API_URL = "https://api.openai.com/v1/audio/transcriptions";
const WHISPER_MODEL = "whisper-1";

/**
 * Transcribe an audio buffer using the OpenAI Whisper API.
 * Returns the transcribed text.
 */
export async function transcribe(
  audioBuffer: Buffer,
  mimeType: string,
  apiKey: string,
): Promise<string> {
  const log = logger.child({ service: "transcription" });

  // Map mime type to file extension for Whisper API
  const extMap: Record<string, string> = {
    "audio/webm": "webm",
    "audio/wav": "wav",
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/flac": "flac",
  };
  const ext = extMap[mimeType] ?? "webm";

  const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
  const formData = new FormData();
  formData.append("file", blob, `recording.${ext}`);
  formData.append("model", WHISPER_MODEL);

  log.info({ mimeType, byteSize: audioBuffer.length }, "Calling Whisper API");

  const response = await fetch(WHISPER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text();
    log.error({ status: response.status, body }, "Whisper API error");
    throw new Error(`Whisper API error ${response.status}: ${body}`);
  }

  const result = (await response.json()) as { text?: string };
  const text = result.text?.trim() ?? "";

  if (!text) {
    throw new Error("Whisper returned empty transcription");
  }

  log.info({ textLength: text.length }, "Transcription complete");
  return text;
}
