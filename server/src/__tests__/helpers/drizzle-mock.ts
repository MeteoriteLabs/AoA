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
  count: (...args: unknown[]) => string;
  sql: unknown;
};

/** Sentinel object returned by the sql proxy when used as a tagged template or called. */
const SQL_SENTINEL = {
  as: (_alias: string) => SQL_SENTINEL,
  join: () => SQL_SENTINEL,
  raw: (_s: string) => SQL_SENTINEL,
  sql: "sql",
  toString: () => "sql",
};

export function drizzleOperatorStubs(): OperatorStubs {
  // The sql proxy needs to handle four call patterns:
  //   1. sql`template string`     — tagged template (apply trap)
  //   2. sql`template`.as("name") — chained .as() on tagged template result
  //   3. sql.join(arr, sep)       — static method call
  //   4. sql.raw(str)             — static method call
  // All return SQL_SENTINEL or a function that returns SQL_SENTINEL so
  // callers can chain further without errors.
  const sqlProxy: unknown = new Proxy(
    Object.assign(
      function sqlFn(..._args: unknown[]) {
        return SQL_SENTINEL;
      },
      {
        join: (..._args: unknown[]) => SQL_SENTINEL,
        raw: (_s: string) => SQL_SENTINEL,
      },
    ),
    {
      get(target: Record<string, unknown>, prop: string | symbol) {
        if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
        // Any other property access (e.g. Symbol.toPrimitive) returns a no-op
        return () => SQL_SENTINEL;
      },
      apply(_target: unknown, _thisArg: unknown, _args: unknown[]) {
        return SQL_SENTINEL;
      },
    },
  );
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
    count: () => "count",
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

/**
 * Extended sequence DB that supports insert/update/delete/execute in addition
 * to select. Each operation pops the next pre-configured result from its queue.
 *
 * Returned chains are fully thenable so `await db.insert(...).values(...)` works.
 * `execute` is provided for raw-sql paths (e.g. buildMemoryInsert).
 */
export type SequenceDbConfig = {
  selects?: unknown[][];
  inserts?: unknown[][];
  updates?: unknown[][];
  deletes?: unknown[][];
};

export function createExtendedSequenceDb(config: SequenceDbConfig = {}): {
  select: (...args: unknown[]) => Record<string, unknown>;
  insert: (...args: unknown[]) => Record<string, unknown>;
  update: (...args: unknown[]) => Record<string, unknown>;
  delete: (...args: unknown[]) => Record<string, unknown>;
  execute: (...args: unknown[]) => Promise<unknown[]>;
  transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
} {
  let selectIdx = 0;
  let insertIdx = 0;
  let updateIdx = 0;
  let deleteIdx = 0;

  const chainMethods = ["from", "where", "set", "values", "returning", "innerJoin", "leftJoin", "orderBy", "limit"];

  function makeChain(getResult: () => unknown[]): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    for (const m of chainMethods) {
      chain[m] = (..._args: unknown[]) => chain;
    }
    chain.then = (resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) => {
      try {
        return Promise.resolve(resolve(getResult()));
      } catch (e) {
        return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
      }
    };
    chain.catch = (_fn: unknown) => chain;
    chain.finally = (_fn: unknown) => chain;
    return chain;
  }

  const db = {
    select: (..._args: unknown[]) => makeChain(() => config.selects?.[selectIdx++] ?? []),
    insert: (..._args: unknown[]) => makeChain(() => config.inserts?.[insertIdx++] ?? []),
    update: (..._args: unknown[]) => makeChain(() => config.updates?.[updateIdx++] ?? []),
    delete: (..._args: unknown[]) => makeChain(() => config.deletes?.[deleteIdx++] ?? []),
    execute: (..._args: unknown[]) => Promise.resolve(config.inserts?.[insertIdx++] ?? []),
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return db;
}
