export interface TestSupportFlagInput {
  testSupportEnabled: boolean;
  deploymentExposure: string;
  bindHost: string;
  authPublicBaseUrl?: string | null;
  nodeEnv?: string;
}

export class TestSupportFlagUnsafeError extends Error {
  constructor(reason: string) {
    super(
      "Refusing to boot: AOA_E2E_TEST_SUPPORT (an auth-bypass e2e mint seam) " +
        `is set on a non-e2e instance (${reason}). This flag may only run on a ` +
        "private loopback test instance. Unset AOA_E2E_TEST_SUPPORT.",
    );
    this.name = "TestSupportFlagUnsafeError";
  }
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

/** Refuse the auth-bypass flag on any production, public, or non-loopback boot. */
export function assertTestSupportFlagSafe(input: TestSupportFlagInput): void {
  if (!input.testSupportEnabled) return;
  if (input.deploymentExposure !== "private") {
    throw new TestSupportFlagUnsafeError(`deploymentExposure=${input.deploymentExposure}`);
  }
  if (!isLoopbackHost(input.bindHost)) {
    throw new TestSupportFlagUnsafeError(`bindHost=${input.bindHost} (non-loopback)`);
  }

  const rawBaseUrl = input.authPublicBaseUrl?.trim();
  if (rawBaseUrl) {
    let parsed: URL;
    try {
      parsed = new URL(rawBaseUrl);
    } catch {
      throw new TestSupportFlagUnsafeError("authPublicBaseUrl is invalid");
    }
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      !isLoopbackHost(parsed.hostname)
    ) {
      throw new TestSupportFlagUnsafeError(`authPublicBaseUrl=${rawBaseUrl} (non-loopback)`);
    }
  }

  if (input.nodeEnv?.trim().toLowerCase() === "production") {
    throw new TestSupportFlagUnsafeError("NODE_ENV=production");
  }
}
