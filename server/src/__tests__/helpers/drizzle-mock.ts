/**
 * Shared drizzle-orm + @armyofagents/db mock helpers for server tests.
 *
 * Why this exists: importing real schema or real drizzle-orm into Vitest
 * triggers an ESM circular-dependency warning that resolves into runtime
 * `undefined` values. Tests work around this by Proxy-ing every accessed
 * column to a fresh Symbol and stubbing operators as plain strings. This
 * file extracts that pattern so every test gets the same shape.
 *
 * Usage in a test file:
 *
 *   vi.mock("@armyofagents/db", async () => ({
 *     memoryItems: makeTableProxy("memory_items"),
 *     issues: makeTableProxy("issues"),
 *   }));
 *   vi.mock("drizzle-orm", () => drizzleOperatorStubs());
 */

export function makeTableProxy(name: string): Record<string, unknown> {
  const cols: Record<string, symbol> = {};
  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (prop === "_") return { name };
      if (prop === "$inferSelect" || prop === "$inferInsert") return {};
      if (typeof prop === "string") {
        if (!cols[prop]) cols[prop] = Symbol(prop);
        return cols[prop];
      }
      return undefined;
    },
  });
}

type OperatorStubs = {
  and: (...args: unknown[]) => string;
  or: (...args: unknown[]) => string;
  eq: (...args: unknown[]) => string;
  ne: (...args: unknown[]) => string;
  isNull: (...args: unknown[]) => string;
  isNotNull: (...args: unknown[]) => string;
  inArray: (...args: unknown[]) => string;
  notInArray: (...args: unknown[]) => string;
  gt: (...args: unknown[]) => string;
  gte: (...args: unknown[]) => string;
  lt: (...args: unknown[]) => string;
  lte: (...args: unknown[]) => string;
  like: (...args: unknown[]) => string;
  ilike: (...args: unknown[]) => string;
  desc: (...args: unknown[]) => string;
  asc: (...args: unknown[]) => string;
  sql: unknown;
};

export function drizzleOperatorStubs(): OperatorStubs {
  const sqlProxy = new Proxy(() => "sql", {
    get: () => () => "sql",
    apply: () => "sql",
  });
  return {
    and: () => "and",
    or: () => "or",
    eq: () => "eq",
    ne: () => "ne",
    isNull: () => "isNull",
    isNotNull: () => "isNotNull",
    inArray: () => "inArray",
    notInArray: () => "notInArray",
    gt: () => "gt",
    gte: () => "gte",
    lt: () => "lt",
    lte: () => "lte",
    like: () => "like",
    ilike: () => "ilike",
    desc: () => "desc",
    asc: () => "asc",
    sql: sqlProxy,
  };
}

/**
 * Convenience factory: returns an object with a `select`/`insert`/`update`/`delete`
 * stub where each call resolves to the next pre-configured result.
 *
 * Use when a service-under-test calls db.select().from(...).where(...) twice
 * and you want each call to return a different array.
 */
export function createSequenceDb(results: unknown[][]): {
  select: () => { from: () => { where: () => Promise<unknown[]> } };
  __remaining: () => number;
} {
  const queue = [...results];
  const next = (): Promise<unknown[]> => {
    const r = queue.shift();
    if (!r) throw new Error("createSequenceDb: ran out of pre-configured results");
    return Promise.resolve(r);
  };
  return {
    select: () => ({ from: () => ({ where: () => next() }) }),
    __remaining: () => queue.length,
  };
}
