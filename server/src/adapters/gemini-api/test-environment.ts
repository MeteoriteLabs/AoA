import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AdapterEnvironmentTestContext, AdapterEnvironmentTestResult } from "../types.js";
import { resolveApiKey, buildTestResult } from "../api-common.js";

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const companyId = ctx.companyId;
  if (!companyId) {
    return buildTestResult("gemini_api", "fail", [
      { code: "no_company", level: "error", message: "Agent has no company ID" },
    ]);
  }

  try {
    const apiKey = await resolveApiKey(companyId, "google");
    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    await model.countTokens("test");

    return buildTestResult("gemini_api", "pass", [
      { code: "api_key_valid", level: "info", message: "Google API key is valid" },
    ]);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const isMissing = (err as any).errorCode === "missing_api_key";

    return buildTestResult("gemini_api", "fail", [
      {
        code: isMissing ? "api_key_missing" : "api_key_invalid",
        level: "error",
        message: err.message,
        hint: "Go to Settings > LLM Providers to configure your Google API key.",
      },
    ]);
  }
}
