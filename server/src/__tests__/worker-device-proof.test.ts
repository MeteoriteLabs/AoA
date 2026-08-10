import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";

async function proofModule() {
  return import("../services/worker-device-proof.js").catch(() => null);
}

const bodyDigest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const vector = {
  method: "post",
  path: "/api/worker-control/../worker-control/./enroll?ignored=yes",
  bodyDigest,
  correlationId: "00000000-0000-4000-8000-000000000101",
  issuedAt: "2026-08-10T00:00:00.000Z",
  proofId: "proof-0000000000000001",
};
const canonical = [
  "AOA-DEVICE-PROOF-V1",
  "POST",
  "/api/worker-control/enroll",
  bodyDigest,
  "00000000-0000-4000-8000-000000000101",
  "2026-08-10T00:00:00.000Z",
  "proof-0000000000000001",
].join("\n");

describe("JOB-002 versioned Ed25519 HTTP device proof", () => {
  it("matches the exact canonicalization vector without changing frozen E1 JSON", async () => {
    const mod = await proofModule();
    expect(mod, "worker-device-proof module is not implemented").not.toBeNull();
    expect(mod!.buildDeviceProofCanonicalInput(vector)).toBe(canonical);
  });

  it("accepts the exact vector and rejects method/path/body/request-id/skew/signature tamper", async () => {
    const mod = await proofModule();
    expect(mod, "worker-device-proof module is not implemented").not.toBeNull();
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicKeyDer = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
    const signature = sign(null, Buffer.from(canonical), privateKey).toString("base64url");
    const proof = {
      version: "1",
      publicKey: publicKeyDer,
      signature,
      issuedAt: vector.issuedAt,
      proofId: vector.proofId,
    };
    const now = new Date("2026-08-10T00:00:30.000Z");
    expect(mod!.verifyDeviceProof({ ...vector, proof, now })).toEqual(expect.objectContaining({
      publicKey: publicKeyDer,
      deviceThumbprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    for (const changed of [
      { method: "PUT" },
      { path: "/api/worker-control/session" },
      { bodyDigest: "f".repeat(64) },
      { correlationId: "00000000-0000-4000-8000-000000000102" },
    ]) {
      expect(() => mod!.verifyDeviceProof({ ...vector, ...changed, proof, now })).toThrow(/device proof/i);
    }
    expect(() => mod!.verifyDeviceProof({ ...vector, proof: { ...proof, signature: "bad" }, now })).toThrow(/device proof/i);
    expect(() => mod!.verifyDeviceProof({ ...vector, proof, now: new Date("2026-08-10T00:10:00.000Z") })).toThrow(/device proof/i);
  });
});
