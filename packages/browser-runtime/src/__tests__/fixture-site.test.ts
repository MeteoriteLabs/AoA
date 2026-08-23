// BRW-002 — the fixture site serves what the four required cases need (no browser required).
//
// Testing the fixture itself matters: every browser assertion downstream is only as
// trustworthy as this. A fixture that quietly stopped serving a Content-Disposition header
// would turn the download tests into tests of nothing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureSite, type FixtureSite } from "../fixture-site.js";

let site: FixtureSite;

beforeAll(async () => {
  site = await startFixtureSite();
});
afterAll(async () => {
  await site?.close();
});

describe("BRW-002 fixture site — navigation", () => {
  it("serves an index with a stable title", async () => {
    const res = await fetch(`${site.origin}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("BRW-002 fixture index");
  });

  it("serves a second page to navigate to", async () => {
    expect(await (await fetch(`${site.origin}/second`)).text()).toContain("fixture second");
  });

  it("404s an unknown path rather than serving the index", async () => {
    // Without this, a navigation test could "pass" against a catch-all.
    expect((await fetch(`${site.origin}/nope`)).status).toBe(404);
  });
});

describe("BRW-002 fixture site — downloads", () => {
  it("serves an attachment with a filename", async () => {
    const res = await fetch(`${site.origin}/download`);
    expect(res.headers.get("content-disposition")).toContain('filename="report.csv"');
    expect(await res.text()).toContain("col_a");
  });

  it("serves the hostile filenames verbatim, unencoded", async () => {
    // The point of these fixtures is that the header is attacker-controlled. If the fixture
    // sanitised them, the browser-side observation would prove nothing.
    const traversal = await fetch(`${site.origin}/download-traversal`);
    expect(traversal.headers.get("content-disposition")).toContain("../../escape.txt");
    const absolute = await fetch(`${site.origin}/download-absolute`);
    expect(absolute.headers.get("content-disposition")).toContain("/etc/passwd");
  });
});

describe("BRW-002 fixture site — popup and slow pages", () => {
  it("serves a page with both popup mechanisms", async () => {
    // target=_blank and window.open take different paths through Chromium; a fixture with
    // only one would leave the other untested.
    const body = await (await fetch(`${site.origin}/popup`)).text();
    expect(body).toContain('target="_blank"');
    expect(body).toContain("window.open");
  });

  it("serves a page that keeps a timer running", async () => {
    // The kill case needs a page that is still DOING something, so a surviving browser is
    // observable rather than idle.
    expect(await (await fetch(`${site.origin}/slow`)).text()).toContain("setInterval");
  });
});

describe("BRW-002 fixture site — binds loopback only", () => {
  it("reports a loopback origin", () => {
    // In a sandbox a wildcard bind is publicly routable — measured by the port-exposure
    // probe. The fixture must not be the thing that opens a public port.
    expect(site.origin.startsWith("http://127.0.0.1:")).toBe(true);
    expect(site.port).toBeGreaterThan(0);
  });
});
