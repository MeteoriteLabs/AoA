/**
 * WRK-013 — the durable lease-candidate store.
 *
 * A restarting daemon replays the offers it ACKed and never saw end into
 * `StartupReconcilerDeps.leaseCandidates`. The store is keyed PER LEASE (F10): two
 * Organizations' leases on one daemon are two independent rows, and pruning one never
 * touches the other. A store that cannot be read FAILS CLOSED — it throws a named error
 * rather than returning a partial or empty list, because an empty list reads as "nothing
 * to reconcile" (the E4-F009 defect).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { leaseOfferV1Schema, type LeaseOfferV1 } from "@armyofagents/worker-protocol";

import { loadDatabaseSync } from "../events/event-outbox-store.js";
import {
  LeaseCandidateStoreCorruptError,
  openLeaseCandidateStore,
  type SqliteLeaseCandidateStore,
} from "../lease/lease-candidate-store.js";
import { compatibleOffer } from "./support/poll-fixtures.js";

const ORG_X = "00000000-0000-4000-8000-00000000e0a1";
const ORG_Y = "00000000-0000-4000-8000-00000000e0b1";
const LEASE_X = "00000000-0000-4000-8000-00000000e0a2";
const LEASE_Y = "00000000-0000-4000-8000-00000000e0b2";
const JOB_X = "00000000-0000-4000-8000-00000000e0a3";
const JOB_Y = "00000000-0000-4000-8000-00000000e0b3";

function offerFor(org: string, lease: string, job: string): LeaseOfferV1 {
  const raw = compatibleOffer({ leaseId: lease }) as { job: Record<string, unknown> };
  raw.job.organizationId = org;
  raw.job.jobId = job;
  return leaseOfferV1Schema.parse(raw);
}

let dir: string;
let path: string;
const opened: SqliteLeaseCandidateStore[] = [];

async function open(): Promise<SqliteLeaseCandidateStore> {
  const store = await openLeaseCandidateStore({ path });
  opened.push(store);
  return store;
}

/** Rewrite one stored row's offer text through a SEPARATE connection while the store is closed —
 * the shape a torn write or a hand-edited file leaves for the next boot. No test hook exists on
 * the production class. */
async function corruptRow(leaseId: string, offerText: string): Promise<void> {
  const Database = await loadDatabaseSync();
  const db = new Database(path);
  try {
    db.prepare("UPDATE lease_candidate SET offer_json = ? WHERE lease_id = ?").run(offerText, leaseId);
  } finally {
    db.close();
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lease-candidates-"));
  path = join(dir, "lease-candidates.db");
});
afterEach(() => {
  for (const store of opened.splice(0)) {
    try {
      store.close();
    } catch {
      // already closed by the test
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("lease-candidate-store — put / remove / list", () => {
  it("a new store lists nothing", async () => {
    const store = await open();
    expect(store.list()).toEqual([]);
  });

  it("put persists the FULL offer and list replays it, byte-for-byte schema-equal", async () => {
    const store = await open();
    const offer = offerFor(ORG_X, LEASE_X, JOB_X);
    store.put(offer);
    expect(store.list()).toEqual([offer]);
  });

  it("survives a close + reopen (the restart the store exists for)", async () => {
    const first = await open();
    const offer = offerFor(ORG_X, LEASE_X, JOB_X);
    first.put(offer);
    first.close();
    const second = await open();
    expect(second.list()).toEqual([offer]);
  });

  it("put is idempotent per lease (a re-put replaces, never duplicates)", async () => {
    const store = await open();
    const offer = offerFor(ORG_X, LEASE_X, JOB_X);
    store.put(offer);
    store.put(offer);
    expect(store.list()).toHaveLength(1);
  });

  it("remove prunes exactly that lease; removing an unknown lease is a no-op", async () => {
    const store = await open();
    store.put(offerFor(ORG_X, LEASE_X, JOB_X));
    store.remove(LEASE_Y);
    expect(store.list()).toHaveLength(1);
    store.remove(LEASE_X);
    expect(store.list()).toEqual([]);
  });
});

describe("lease-candidate-store — multi-tenant (F10): keyed per lease, never per Organization", () => {
  it("two Organizations' leases are two independent rows; pruning one leaves the other", async () => {
    const store = await open();
    const x = offerFor(ORG_X, LEASE_X, JOB_X);
    const y = offerFor(ORG_Y, LEASE_Y, JOB_Y);
    store.put(x);
    store.put(y);
    // Same-tenant positive control: both are listed, each with its own identity.
    const listed = store.list();
    expect(listed).toHaveLength(2);
    expect(listed.find((o) => o.leaseId === LEASE_X)?.job.organizationId).toBe(ORG_X);
    expect(listed.find((o) => o.leaseId === LEASE_Y)?.job.organizationId).toBe(ORG_Y);
    // Cross-tenant: pruning Organization X's lease never removes Organization Y's.
    store.remove(LEASE_X);
    expect(store.list()).toEqual([y]);
  });
});

describe("lease-candidate-store — a store it cannot read FAILS CLOSED (S0-8 amendment 5)", () => {
  it("a file that is not a database refuses to open with the named corrupt error", async () => {
    writeFileSync(path, Buffer.from("this is not a sqlite database, it is garbage ".repeat(40)));
    await expect(openLeaseCandidateStore({ path })).rejects.toBeInstanceOf(LeaseCandidateStoreCorruptError);
  });

  it("an undecodable row makes list() THROW — never a partial or empty list", async () => {
    const writer = await open();
    writer.put(offerFor(ORG_X, LEASE_X, JOB_X));
    writer.close();
    await corruptRow(LEASE_X, "{not json");
    const store = await open();
    expect(() => store.list()).toThrow(LeaseCandidateStoreCorruptError);
  });

  it("a row whose offer no longer matches its key is corrupt (a lease cannot be misattributed)", async () => {
    const writer = await open();
    writer.put(offerFor(ORG_X, LEASE_X, JOB_X));
    writer.close();
    // Rewrite X's row to carry Y's offer: the stored key and the offer's own leaseId disagree.
    await corruptRow(LEASE_X, JSON.stringify(offerFor(ORG_Y, LEASE_Y, JOB_Y)));
    const store = await open();
    expect(() => store.list()).toThrow(LeaseCandidateStoreCorruptError);
  });

  it("clear() empties an unreadable store so it is not re-read on every boot", async () => {
    const writer = await open();
    writer.put(offerFor(ORG_X, LEASE_X, JOB_X));
    writer.close();
    await corruptRow(LEASE_X, "{not json");
    const store = await open();
    store.clear();
    expect(store.list()).toEqual([]);
  });
});
