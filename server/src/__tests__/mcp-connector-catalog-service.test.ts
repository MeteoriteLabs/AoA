import { describe, it, expect, vi, beforeEach } from "vitest";

const warn = vi.fn();
vi.mock("../middleware/logger.js", () => ({
  logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { createConnectorCatalogService, CONNECTOR_CATALOG_TTL_MS } = await import(
  "../services/mcp-connector-catalog.js"
);

const URL_ = "https://cdn.example.test/connectors.json";
const T0 = 1_000_000;

function httpEntry(id: string) {
  return {
    id,
    displayName: id,
    serverName: id,
    transport: "http",
    url: `https://${id}.example.test/mcp`,
  };
}

/** A response whose body is whatever you hand it. */
function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  warn.mockClear();
});

describe("connector catalog service — happy path", () => {
  it("fetches and parses the CDN body", async () => {
    const fetchFn = vi.fn(async () => okJson({ entries: [httpEntry("alpha"), httpEntry("beta")] }));
    const svc = createConnectorCatalogService({ url: URL_, fetchFn: fetchFn as unknown as typeof fetch });

    const res = await svc.load(T0);
    expect(res.stale).toBe(false);
    expect(res.entries.map((e) => e.id)).toEqual(["alpha", "beta"]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(URL_);
  });

  it("serves the cache within the TTL without refetching", async () => {
    const fetchFn = vi.fn(async () => okJson({ entries: [httpEntry("alpha")] }));
    const svc = createConnectorCatalogService({ url: URL_, fetchFn: fetchFn as unknown as typeof fetch });

    await svc.load(T0);
    const second = await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS - 1);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(second.stale).toBe(false);
    expect(second.entries.map((e) => e.id)).toEqual(["alpha"]);
  });

  it("refetches once the TTL has elapsed", async () => {
    let body: unknown = { entries: [httpEntry("alpha")] };
    const fetchFn = vi.fn(async () => okJson(body));
    const svc = createConnectorCatalogService({ url: URL_, fetchFn: fetchFn as unknown as typeof fetch });

    await svc.load(T0);
    body = { entries: [httpEntry("alpha"), httpEntry("gamma")] };
    const second = await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(second.stale).toBe(false);
    expect(second.entries.map((e) => e.id)).toEqual(["alpha", "gamma"]);
  });

  it("uses a 6-hour TTL", () => {
    expect(CONNECTOR_CATALOG_TTL_MS).toBe(6 * 60 * 60 * 1000);
  });

  it("hands back a copy, so a caller mutating the result cannot corrupt the cache", async () => {
    const fetchFn = vi.fn(async () => okJson({ entries: [httpEntry("alpha")] }));
    const svc = createConnectorCatalogService({ url: URL_, fetchFn: fetchFn as unknown as typeof fetch });

    const first = await svc.load(T0);
    first.entries.length = 0;
    const second = await svc.load(T0 + 1);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(second.entries.map((e) => e.id)).toEqual(["alpha"]);
  });
});

describe("connector catalog service — degradation", () => {
  it("serves last-known-good with stale:true when the fetch throws", async () => {
    let mode: "ok" | "throw" = "ok";
    const fetchFn = vi.fn(async () => {
      if (mode === "throw") throw new Error("ENOTFOUND");
      return okJson({ entries: [httpEntry("alpha")] });
    });
    const svc = createConnectorCatalogService({ url: URL_, fetchFn: fetchFn as unknown as typeof fetch });

    await svc.load(T0);
    mode = "throw";
    const res = await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS);

    expect(res.stale).toBe(true);
    expect(res.entries.map((e) => e.id)).toEqual(["alpha"]);
    expect(warn).toHaveBeenCalled();
  });

  it("returns an empty shelf without throwing when the very first fetch fails", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("offline");
    });
    const svc = createConnectorCatalogService({ url: URL_, fetchFn: fetchFn as unknown as typeof fetch });

    const res = await svc.load(T0);
    expect(res).toEqual({ entries: [], stale: true });
  });

  it("treats a non-ok HTTP status as a failure and keeps the cache", async () => {
    let status = 200;
    const fetchFn = vi.fn(async () =>
      status === 200
        ? okJson({ entries: [httpEntry("alpha")] })
        : ({ ok: false, status, json: async () => ({ entries: [] }) } as unknown as Response),
    );
    const svc = createConnectorCatalogService({ url: URL_, fetchFn: fetchFn as unknown as typeof fetch });

    await svc.load(T0);
    status = 503;
    const res = await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS);

    // A 503 body is NOT parsed — an error page must never be able to empty the shelf.
    expect(res.stale).toBe(true);
    expect(res.entries.map((e) => e.id)).toEqual(["alpha"]);
  });

  it("treats an unparseable body (invalid JSON) as a failure and keeps the cache", async () => {
    let broken = false;
    const fetchFn = vi.fn(async () =>
      broken
        ? ({
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError("Unexpected token <");
            },
          } as unknown as Response)
        : okJson({ entries: [httpEntry("alpha")] }),
    );
    const svc = createConnectorCatalogService({ url: URL_, fetchFn: fetchFn as unknown as typeof fetch });

    await svc.load(T0);
    broken = true;
    const res = await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS);

    expect(res.stale).toBe(true);
    expect(res.entries.map((e) => e.id)).toEqual(["alpha"]);
  });

  it("does NOT mark the cache fresh after a failure — the next load retries", async () => {
    let mode: "ok" | "throw" = "ok";
    const fetchFn = vi.fn(async () => {
      if (mode === "throw") throw new Error("ENOTFOUND");
      return okJson({ entries: [httpEntry("alpha")] });
    });
    const svc = createConnectorCatalogService({ url: URL_, fetchFn: fetchFn as unknown as typeof fetch });

    await svc.load(T0);
    mode = "throw";
    await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    mode = "ok";
    const res = await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS + 1);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(res.stale).toBe(false);
  });
});

describe("connector catalog service — malformed vs legitimately empty", () => {
  it("a MALFORMED response keeps the cached shelf intact", async () => {
    let body: unknown = { entries: [httpEntry("alpha"), httpEntry("beta")] };
    const fetchFn = vi.fn(async () => okJson(body));
    const svc = createConnectorCatalogService({ url: URL_, fetchFn: fetchFn as unknown as typeof fetch });

    await svc.load(T0);
    body = "<html>404 not found</html>"; // valid JSON-able value, unintelligible envelope
    const res = await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS);

    expect(res.stale).toBe(true);
    expect(res.entries.map((e) => e.id)).toEqual(["alpha", "beta"]);
    expect(warn).toHaveBeenCalled();
  });

  it.each([
    ["a bare string", "garbage"],
    ["null", null],
    ["an array at the top level", [{ id: "alpha" }]],
    ["an object with no entries key", { items: [] }],
    ["entries that is not an array", { entries: { alpha: {} } }],
    ["entries: null", { entries: null }],
  ])("keeps the cache when the CDN serves %s", async (_label, badBody) => {
    let body: unknown = { entries: [httpEntry("alpha")] };
    const fetchFn = vi.fn(async () => okJson(body));
    const svc = createConnectorCatalogService({ url: URL_, fetchFn: fetchFn as unknown as typeof fetch });

    await svc.load(T0);
    body = badBody;
    const res = await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS);

    expect(res.stale).toBe(true);
    expect(res.entries.map((e) => e.id)).toEqual(["alpha"]);
  });

  it("a LEGITIMATELY EMPTY response replaces the cache", async () => {
    let body: unknown = { entries: [httpEntry("alpha")] };
    const fetchFn = vi.fn(async () => okJson(body));
    const svc = createConnectorCatalogService({ url: URL_, fetchFn: fetchFn as unknown as typeof fetch });

    await svc.load(T0);
    body = { entries: [] }; // the curator removed every connector — a real state
    const res = await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS);

    expect(res.stale).toBe(false);
    expect(res.entries).toEqual([]);
  });

  it("the emptied cache then persists through the TTL rather than resurrecting", async () => {
    let body: unknown = { entries: [httpEntry("alpha")] };
    const fetchFn = vi.fn(async () => okJson(body));
    const svc = createConnectorCatalogService({ url: URL_, fetchFn: fetchFn as unknown as typeof fetch });

    await svc.load(T0);
    body = { entries: [] };
    await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS);
    const res = await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS + 1);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(res.entries).toEqual([]);
    expect(res.stale).toBe(false);
  });

  it("a malformed FIRST fetch returns an empty shelf as stale, not fresh", async () => {
    const fetchFn = vi.fn(async () => okJson({ nope: true }));
    const svc = createConnectorCatalogService({ url: URL_, fetchFn: fetchFn as unknown as typeof fetch });

    const res = await svc.load(T0);
    expect(res).toEqual({ entries: [], stale: true });
  });
});

describe("connector catalog service — dropped entries", () => {
  it("keeps the good entries and warns naming the dropped ids", async () => {
    const fetchFn = vi.fn(async () =>
      okJson({
        entries: [
          httpEntry("alpha"),
          { ...httpEntry("bad-one"), transport: "carrier-pigeon" }, // unknown transport
          { id: "bad-two" }, // missing required fields
          { displayName: "no id at all" },
          httpEntry("beta"),
        ],
      }),
    );
    const svc = createConnectorCatalogService({ url: URL_, fetchFn: fetchFn as unknown as typeof fetch });

    const res = await svc.load(T0);

    expect(res.stale).toBe(false);
    expect(res.entries.map((e) => e.id)).toEqual(["alpha", "beta"]);
    expect(warn).toHaveBeenCalledTimes(1);
    const [ctx] = warn.mock.calls[0] as [{ dropped?: string[] }, string];
    expect(ctx.dropped).toEqual(["bad-one", "bad-two", "<unidentified>"]);
  });

  it("does not warn when nothing was dropped", async () => {
    const fetchFn = vi.fn(async () => okJson({ entries: [httpEntry("alpha")] }));
    const svc = createConnectorCatalogService({ url: URL_, fetchFn: fetchFn as unknown as typeof fetch });

    await svc.load(T0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("an all-dropped payload still replaces the cache — every entry was answered for", async () => {
    let body: unknown = { entries: [httpEntry("alpha")] };
    const fetchFn = vi.fn(async () => okJson(body));
    const svc = createConnectorCatalogService({ url: URL_, fetchFn: fetchFn as unknown as typeof fetch });

    await svc.load(T0);
    body = { entries: [{ id: "bad-one" }] };
    const res = await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS);

    // Distinct from `malformed`: the envelope was understood, so this is the
    // CDN's real answer — it just contains nothing this version can use.
    expect(res.stale).toBe(false);
    expect(res.entries).toEqual([]);
  });
});
