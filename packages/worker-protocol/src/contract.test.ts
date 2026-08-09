import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  jobCapabilityRequirementsSchema,
  registeredTargetProfileV1Schema,
  verifyAndBrandProviderConstraintProfileV1,
  workerHelloV1Schema,
  workerSatisfiesRequirements,
} from "./capabilities.js";
import { workerEventBatchV1Schema } from "./events.js";
import { jobEnvelopeV1Schema, leaseOfferV1Schema } from "./job.js";
import { findSecretCanaryStringMatches } from "./wire-safety.js";

const sha256hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const contractDir = new URL("../../../docs/contracts/worker-protocol/v1/", import.meta.url);
const conformanceBytes = readFileSync(new URL("conformance.json", contractDir));
const conformance = JSON.parse(conformanceBytes.toString("utf8")) as {
  contractVersion: string;
  cases: ConformanceCase[];
};

interface ConformanceCase {
  name: string;
  schema: "job" | "lease_offer" | "event_batch" | "target_worker_pair";
  valid: boolean;
  preserveKeys?: string[];
  input: Record<string, unknown>;
}

/** The target_worker_pair validator: parse every part with its schema, verify +
 * brand the provider profile, then run the negotiation intersection. */
async function validatePair(input: Record<string, unknown>): Promise<{ success: boolean; data?: unknown }> {
  const target = registeredTargetProfileV1Schema.safeParse(input.registeredTarget);
  const worker = workerHelloV1Schema.safeParse(input.worker);
  const requirements = jobCapabilityRequirementsSchema.safeParse(input.requirements);
  if (!target.success || !worker.success || !requirements.success) return { success: false };
  const verified = await verifyAndBrandProviderConstraintProfileV1(input.providerProfile, sha256hex);
  if (verified === null) return { success: false };
  return { success: workerSatisfiesRequirements(target.data, verified, worker.data, requirements.data), data: input };
}

async function evaluate(c: ConformanceCase): Promise<{ success: boolean; data?: unknown }> {
  switch (c.schema) {
    case "job":
      return jobEnvelopeV1Schema.safeParse(c.input);
    case "lease_offer":
      return leaseOfferV1Schema.safeParse(c.input);
    case "event_batch":
      return workerEventBatchV1Schema.safeParse(c.input);
    case "target_worker_pair":
      return validatePair(c.input);
    default:
      throw new Error(`unknown conformance schema: ${(c as ConformanceCase).schema}`);
  }
}

describe("worker-protocol v1 conformance corpus", () => {
  it("declares contractVersion 1.0.0 with the 16 named cases (unique names)", () => {
    expect(conformance.contractVersion).toBe("1.0.0");
    expect(conformance.cases.length).toBe(16);
    const names = conformance.cases.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(conformance.cases.map((c) => c.schema))).toEqual(
      new Set(["job", "lease_offer", "event_batch", "target_worker_pair"]),
    );
  });

  for (const c of conformance.cases) {
    it(`${c.valid ? "accepts" : "rejects"}: ${c.name}`, async () => {
      const result = await evaluate(c);
      expect(result.success).toBe(c.valid);
      if (c.valid && c.preserveKeys && result.data) {
        const data = result.data as Record<string, unknown>;
        for (const key of c.preserveKeys) {
          expect(data[key]).toEqual(c.input[key]);
        }
      }
    });
  }

  it("rejects the argv canary in case 10 via the producer-safety helper (separate from schema rejection)", () => {
    const canaryCase = conformance.cases.find((c) => c.name === "reject nested plaintext api key and known secret canary");
    expect(canaryCase).toBeDefined();
    const matches = findSecretCanaryStringMatches(canaryCase!.input, ["CANARY-SECRET-9"]);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((path) => path.startsWith("workload.args"))).toBe(true);
  });
});

describe("worker-protocol v1 manifest integrity", () => {
  it("manifest.sha256 pins the exact conformance.json bytes", () => {
    const manifestBytes = readFileSync(new URL("manifest.sha256", contractDir));
    const manifest = manifestBytes.toString("utf8");
    const expectedDigest = sha256hex(conformanceBytes);
    expect(manifest).toBe(`${expectedDigest}  conformance.json\n`);
  });
});
