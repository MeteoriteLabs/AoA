import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
/** Path to the compiled mcp-bridge entrypoint (mirrors cli-mode.ts
 *  getBridgeEntrypoint). The bridge lives one dir up from aoa-agents/. */
export function resolveBridgeEntrypoint(): string {
  const here = typeof __dirname !== "undefined" ? __dirname : fileURLToPath(new URL(".", import.meta.url));
  return resolve(here, "..", "mcp-bridge.js");
}
