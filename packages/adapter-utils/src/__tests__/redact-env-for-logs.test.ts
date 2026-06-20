import { describe, expect, it } from "vitest";
import { redactEnvForLogs } from "../server-utils.js";

/**
 * H4 — redactEnvForLogs is the chokepoint every adapter routes the meta-event
 * `env` through before it is persisted to heartbeat_run_events and broadcast
 * over SSE. Key-name matching alone leaked secrets bound (via secret_ref) to
 * env vars whose NAME isn't obviously sensitive (DATABASE_URL, STRIPE_LIVE,
 * DSN, NPM_AUTH, …). It must also redact values that LOOK like secrets.
 */
describe("redactEnvForLogs (H4)", () => {
  it("redacts by sensitive key name (existing behaviour)", () => {
    const out = redactEnvForLogs({ OPENAI_API_KEY: "sk-whatever", MY_SECRET: "x", AUTH_TOKEN: "y" });
    expect(out.OPENAI_API_KEY).toBe("***REDACTED***");
    expect(out.MY_SECRET).toBe("***REDACTED***");
    expect(out.AUTH_TOKEN).toBe("***REDACTED***");
  });

  it("redacts secret-looking VALUES under innocuous key names", () => {
    const out = redactEnvForLogs({
      DATABASE_URL: "postgresql://user:s3cr3t@db.internal:5432/app",
      REDIS_DSN: "rediss://default:p4ss@cache:6379",
      STRIPE_LIVE: "sk_live_abcdEFGH12345678",
      PROVIDER: "sk-ant-abcdefghijklmnop",
      DEPLOY_PAT: "ghp_abcdefghijklmnopqrstuvwxyz0123",
      SIGNING: "-----BEGIN RSA PRIVATE KEY-----\nMIIE...",
    });
    expect(out.DATABASE_URL).toBe("***REDACTED***");
    expect(out.REDIS_DSN).toBe("***REDACTED***");
    expect(out.STRIPE_LIVE).toBe("***REDACTED***");
    expect(out.PROVIDER).toBe("***REDACTED***");
    expect(out.DEPLOY_PAT).toBe("***REDACTED***");
    expect(out.SIGNING).toBe("***REDACTED***");
  });

  it("preserves non-secret values, including the http:// API URL", () => {
    const out = redactEnvForLogs({
      NODE_ENV: "production",
      AOA_API_URL: "http://localhost:3100",
      LOG_LEVEL: "info",
      PORT: "3100",
    });
    expect(out.NODE_ENV).toBe("production");
    expect(out.AOA_API_URL).toBe("http://localhost:3100");
    expect(out.LOG_LEVEL).toBe("info");
    expect(out.PORT).toBe("3100");
  });
});
