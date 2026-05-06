import { describe, expect, it } from "vitest";
import { isPrivateIP, validateAndResolveFetchUrl } from "../services/outbound-url-guard.js";

describe("isPrivateIP", () => {
  it("rejects IPv4 RFC 1918 ranges", () => {
    expect(isPrivateIP("10.0.0.1")).toBe(true);
    expect(isPrivateIP("172.16.0.1")).toBe(true);
    expect(isPrivateIP("172.31.255.255")).toBe(true);
    expect(isPrivateIP("172.20.5.5")).toBe(true);
    expect(isPrivateIP("192.168.1.1")).toBe(true);
  });
  it("rejects loopback", () => {
    expect(isPrivateIP("127.0.0.1")).toBe(true);
    expect(isPrivateIP("127.255.255.255")).toBe(true);
  });
  it("rejects link-local IPv4 (169.254/16)", () => {
    expect(isPrivateIP("169.254.169.254")).toBe(true); // cloud metadata
    expect(isPrivateIP("169.254.0.1")).toBe(true);
  });
  it("rejects 0.0.0.0", () => {
    expect(isPrivateIP("0.0.0.0")).toBe(true);
  });
  it("rejects IPv6 loopback + ULA + link-local", () => {
    expect(isPrivateIP("::1")).toBe(true);
    expect(isPrivateIP("::")).toBe(true);
    expect(isPrivateIP("fc00::1")).toBe(true);
    expect(isPrivateIP("fd00::1")).toBe(true);
    expect(isPrivateIP("fe80::1")).toBe(true);
  });
  it("rejects IPv4-mapped IPv6 (::ffff:127.0.0.1)", () => {
    expect(isPrivateIP("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIP("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateIP("::ffff:169.254.169.254")).toBe(true);
  });
  it("does NOT reject 172.15.x.x or 172.32.x.x (boundary)", () => {
    expect(isPrivateIP("172.15.255.255")).toBe(false);
    expect(isPrivateIP("172.32.0.0")).toBe(false);
  });
  it("does NOT reject public IPs", () => {
    expect(isPrivateIP("8.8.8.8")).toBe(false);
    expect(isPrivateIP("1.1.1.1")).toBe(false);
    expect(isPrivateIP("2606:4700:4700::1111")).toBe(false); // Cloudflare DNS IPv6
  });
});

describe("validateAndResolveFetchUrl — protocol gate", () => {
  it("rejects file://", async () => {
    await expect(validateAndResolveFetchUrl("file:///etc/passwd"))
      .rejects.toThrow(/Disallowed protocol/);
  });
  it("rejects gopher://", async () => {
    await expect(validateAndResolveFetchUrl("gopher://example.com/"))
      .rejects.toThrow(/Disallowed protocol/);
  });
  it("rejects javascript:", async () => {
    await expect(validateAndResolveFetchUrl("javascript:alert(1)"))
      .rejects.toThrow(/Disallowed protocol/);
  });
  it("rejects malformed URL", async () => {
    await expect(validateAndResolveFetchUrl("not-a-url"))
      .rejects.toThrow(/Invalid URL/);
  });
});

describe("validateAndResolveFetchUrl — private IP gate (literal IPs in hostname)", () => {
  it("rejects loopback", async () => {
    await expect(validateAndResolveFetchUrl("http://127.0.0.1/"))
      .rejects.toThrow(/private/);
  });
  it("rejects cloud metadata (169.254.169.254)", async () => {
    await expect(validateAndResolveFetchUrl("http://169.254.169.254/latest/meta-data/"))
      .rejects.toThrow(/private/);
  });
  it("rejects RFC 1918 (10.0.0.1)", async () => {
    await expect(validateAndResolveFetchUrl("http://10.0.0.1/"))
      .rejects.toThrow(/private/);
  });
  it("rejects IPv6 loopback ([::1])", async () => {
    await expect(validateAndResolveFetchUrl("http://[::1]/"))
      .rejects.toThrow(/private/);
  });
});
