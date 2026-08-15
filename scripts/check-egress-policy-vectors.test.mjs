import assert from "node:assert/strict";
import test from "node:test";

import {
  EgressPolicyVectorError,
  NETWORK_DENIAL_CLASSES,
  classifyEgress,
  ipInCidr,
  isPrivateIp,
  loadFixture,
  parseIp,
  verifyFixture,
} from "./check-egress-policy-vectors.mjs";

const ALLOW = [{ host: "api.notion.com", port: 443 }];
const CP = ["45.55.0.0/16", "2606:1234::/32"];

test("the checked-in fixture passes the reference checker", () => {
  const { allows, denies } = verifyFixture(loadFixture());
  assert.ok(allows >= 4);
  assert.ok(denies >= 10);
});

test("NETWORK_DENIAL_CLASSES is exactly the four frozen classes", () => {
  assert.deepEqual([...NETWORK_DENIAL_CLASSES].sort(), ["control_plane", "metadata", "not_allowlisted", "private"]);
});

test("allowlist gate: https allowlisted public host is allowed", () => {
  assert.equal(classifyEgress("https://api.notion.com/v1", ["104.18.0.1"], ALLOW, CP), "allow");
});

test("allowlist gate: non-allowlisted / non-https / wrong-port / unparseable → not_allowlisted", () => {
  assert.equal(classifyEgress("https://evil.example/x", ["104.18.0.1"], ALLOW, CP), "not_allowlisted");
  assert.equal(classifyEgress("http://api.notion.com/v1", ["104.18.0.1"], ALLOW, CP), "not_allowlisted");
  assert.equal(classifyEgress("https://api.notion.com:9000/v1", ["104.18.0.1"], ALLOW, CP), "not_allowlisted");
  assert.equal(classifyEgress("nope", ["104.18.0.1"], ALLOW, CP), "not_allowlisted");
});

test("IP gate: rebind to private / metadata / control-plane classes", () => {
  assert.equal(classifyEgress("https://api.notion.com/v1", ["10.0.0.1"], ALLOW, CP), "private");
  assert.equal(classifyEgress("https://api.notion.com/v1", ["169.254.169.254"], ALLOW, CP), "metadata");
  assert.equal(classifyEgress("https://api.notion.com/v1", ["45.55.9.9"], ALLOW, CP), "control_plane");
});

test("IP gate: deny if ANY resolved address is unsafe (multi-homed rebind)", () => {
  assert.equal(classifyEgress("https://api.notion.com/v1", ["104.18.0.1", "127.0.0.1"], ALLOW, CP), "private");
});

test("IP gate: empty resolution is fail-closed private", () => {
  assert.equal(classifyEgress("https://api.notion.com/v1", [], ALLOW, CP), "private");
});

test("precedence: metadata > control_plane > private", () => {
  assert.equal(classifyEgress("https://api.notion.com/v1", ["169.254.169.254", "45.55.1.1"], ALLOW, CP), "metadata");
  // 198.51.100.x is TEST-NET-2 (private) AND a control-plane range → control_plane wins.
  assert.equal(classifyEgress("https://api.notion.com/v1", ["198.51.100.5"], ALLOW, ["198.51.100.0/24"]), "control_plane");
});

test("ipInCidr + parseIp handle v4, v6, and mapped forms", () => {
  assert.equal(ipInCidr("10.1.2.3", "10.0.0.0/8"), true);
  assert.equal(ipInCidr("11.1.2.3", "10.0.0.0/8"), false);
  assert.equal(ipInCidr("2606:1234:5::1", "2606:1234::/32"), true);
  assert.equal(parseIp("::ffff:169.254.169.254").family, 4);
  assert.equal(isPrivateIp("192.168.1.1"), true);
  assert.equal(isPrivateIp("8.8.8.8"), false);
});

test("verifyFixture throws when an allow vector is mutated to resolve private", () => {
  const fixture = structuredClone(loadFixture());
  fixture.allowVectors[0].resolvedAddrs = ["10.0.0.1"];
  assert.throws(() => verifyFixture(fixture), EgressPolicyVectorError);
});

test("verifyFixture throws when a deny vector's expected class is wrong", () => {
  const fixture = structuredClone(loadFixture());
  const target = fixture.denyVectors.find((v) => v.name === "cloud_metadata_imds");
  target.class = "private";
  assert.throws(() => verifyFixture(fixture), EgressPolicyVectorError);
});
