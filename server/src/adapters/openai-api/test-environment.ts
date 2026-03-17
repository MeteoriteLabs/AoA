import OpenAI from "openai";
import type { AdapterEnvironmentTestContext, AdapterEnvironmentTestResult } from "../types.js";
import { resolveApiKey, buildTestResult } from "../api-common.js";

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const companyId = ctx.companyId;
  if (!companyId) {
    return buildTestResult("openai_api", "fail", [
      { code: "no_company", level: "error", message: "Agent has no company ID" },
    ]);
  }

  try {
    const apiKey = await resolveApiKey(companyId, "openai");
    const client = new OpenAI({ apiKey, timeout: 10_000 });

    await client.models.list();

    return buildTestResult("openai_api", "pass", [
      { code: "api_key_valid", level: "info", message: "OpenAI API key is valid" },
    ]);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const isMissing = (err as any).errorCode === "missing_api_key";

    return buildTestResult("openai_api", "fail", [
      {
        code: isMissing ? "api_key_missing" : "api_key_invalid",
        level: "error",
        message: err.message,
        hint: "Go to Settings > LLM Providers to configure your OpenAI API key.",
      },
    ]);
  }
}
