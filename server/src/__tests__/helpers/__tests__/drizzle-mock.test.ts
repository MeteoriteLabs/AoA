import { describe, it, expect } from "vitest";
import { makeTableProxy, drizzleOperatorStubs } from "../drizzle-mock.js";

describe("makeTableProxy", () => {
  it("returns a stable symbol per column accessed", () => {
    const t = makeTableProxy("users");
    expect(t.id).toBe(t.id);
    expect(t.email).toBe(t.email);
    expect(t.id).not.toBe(t.email);
  });

  it("exposes the table name on the underscore key (drizzle convention)", () => {
    const t = makeTableProxy("users");
    expect((t as unknown as { _: { name: string } })._.name).toBe("users");
  });

  it("returns an empty object for $inferSelect / $inferInsert", () => {
    const t = makeTableProxy("users");
    expect((t as unknown as { $inferSelect: object }).$inferSelect).toEqual({});
    expect((t as unknown as { $inferInsert: object }).$inferInsert).toEqual({});
  });
});

describe("drizzleOperatorStubs", () => {
  it("returns string sentinels for and/eq/isNull/inArray/desc/asc", () => {
    const ops = drizzleOperatorStubs();
    expect(ops.and()).toBe("and");
    expect(ops.eq()).toBe("eq");
    expect(ops.isNull()).toBe("isNull");
    expect(ops.inArray()).toBe("inArray");
    expect(ops.desc()).toBe("desc");
    expect(ops.asc()).toBe("asc");
  });

  it("provides an sql template tag that returns a string sentinel", () => {
    const ops = drizzleOperatorStubs();
    // Both call form and tagged-template form must work.
    expect((ops.sql as unknown as () => string)()).toBe("sql");
    expect((ops.sql as unknown as (s: TemplateStringsArray) => string)`SELECT 1`).toBe("sql");
  });
});
