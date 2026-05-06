import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
  executePinnedRequest,
  isPrivateIP,
  validateAndResolveFetchUrl,
  type ValidatedFetchTarget,
} from "../services/outbound-url-guard.js";

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

describe("executePinnedRequest", () => {
  it("connects to the pinned IP and returns status + body", async () => {
    // Spin up a tiny HTTP server on 127.0.0.1
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("pinned-ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    const port = address.port;

    // Construct ValidatedFetchTarget manually (bypasses validate-private-IP gate).
    // Pretend the URL was http://example.test/whatever and the resolved IP is 127.0.0.1.
    const target: ValidatedFetchTarget = {
      parsedUrl: new URL(`http://example.test:${port}/`),
      resolvedAddress: "127.0.0.1",
      hostHeader: `example.test:${port}`,
      tlsServername: undefined,
      useTls: false,
    };

    const controller = new AbortController();
    try {
      const res = await executePinnedRequest(target, { method: "GET" }, controller.signal);
      expect(res.status).toBe(200);
      expect(res.body).toBe("pinned-ok");
    } finally {
      server.close();
    }
  });

  it("respects maxBodyBytes cap by destroying the response when body exceeds limit", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200);
      res.end("a".repeat(100)); // 100 bytes
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    const port = address.port;

    const target: ValidatedFetchTarget = {
      parsedUrl: new URL(`http://example.test:${port}/`),
      resolvedAddress: "127.0.0.1",
      hostHeader: `example.test:${port}`,
      tlsServername: undefined,
      useTls: false,
    };

    const controller = new AbortController();
    try {
      await expect(
        executePinnedRequest(target, { method: "GET" }, controller.signal, { maxBodyBytes: 10 }),
      ).rejects.toThrow(/exceeded 10 bytes/);
    } finally {
      server.close();
    }
  });

  it("sends the request body when init.body is provided", async () => {
    let receivedBody = "";
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        receivedBody = Buffer.concat(chunks).toString("utf8");
        res.writeHead(201);
        res.end("created");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    const port = address.port;

    const target: ValidatedFetchTarget = {
      parsedUrl: new URL(`http://example.test:${port}/`),
      resolvedAddress: "127.0.0.1",
      hostHeader: `example.test:${port}`,
      tlsServername: undefined,
      useTls: false,
    };

    const controller = new AbortController();
    try {
      const res = await executePinnedRequest(
        target,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hello: "world" }),
        },
        controller.signal,
      );
      expect(res.status).toBe(201);
      expect(receivedBody).toBe('{"hello":"world"}');
    } finally {
      server.close();
    }
  });
});
