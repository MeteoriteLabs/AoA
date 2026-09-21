/**
 * Durable lease-candidate store (WRK-013, closes E4-F009).
 *
 * The startup reconciler infers lease authority by probing each lease the daemon held
 * when it last stopped. Until this store existed nothing recorded those leases — the
 * event outbox persists EVENTS, not offers — so the probe ran over `[]` on every boot:
 * a reconciler that reconciled nothing while its gate clause read as satisfied.
 *
 * A row is WRITTEN just BEFORE a lease is ACKed (the poll loop's `handleOffer`), so no crash
 * can leave an ACKed lease unrecorded. It is withdrawn if the ACK does not succeed, and PRUNED
 * when that attempt's handoff settles in this process. A row that survives to the next boot
 * is a lease this daemon ACKed, or crashed while ACKing, and never saw end: a restart
 * candidate. A never-ACKed row probes dead and is pruned.
 *
 * Keyed PER LEASE (F10): a daemon serving several Organizations holds one row per
 * lease, and pruning one never touches another. The row also carries the lease's
 * Organization so a log line or an operator can attribute it.
 *
 * FAILS CLOSED. A file that is not a database, or a row that does not decode to the
 * offer its key names, raises {@link LeaseCandidateStoreCorruptError} — never a partial
 * or empty list, because an empty list is indistinguishable from "nothing to reconcile".
 * What the caller closes on that error is RENEWAL: it probes nothing it cannot account
 * for, and the control plane's reaper ends any attempt the daemon held.
 *
 * Runtime imports: `node:sqlite` (dynamically, through the outbox's warning-filtered
 * loader) + `node:fs` + the frozen protocol — the E4-D01 boundary. No npm SQLite driver.
 */

import { chmodSync, renameSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

import { leaseOfferV1Schema, type LeaseOfferV1 } from "@armyofagents/worker-protocol";

import { loadDatabaseSync } from "../events/event-outbox-store.js";

/**
 * The NAMED reasons the composed startup reconcile logs (WRK-013). A reason is a bounded
 * token, never a sentence, so an operator can alert on it and a test can assert it.
 */
export const LEASE_CANDIDATE_REASONS = {
  /** The store was read and held no candidate — a real "nothing to reconcile", said out loud. */
  empty: "lease_candidate_store_empty",
  /** The store could not be read. Renewal is closed for every lease it would have named. */
  unreadable: "lease_candidate_store_unreadable",
  /** No store path was configured, so this daemon records no candidates at all. */
  notConfigured: "lease_candidate_store_not_configured",
  /** A write-on-ACK or a prune failed; that lease is left to the control-plane reaper. */
  writeFailed: "lease_candidate_write_failed",
  /** F5: the probe found the lease live; its renewal was the last — the reaper ends it. */
  fenced: "lease_candidate_fenced",
  /** The probe found the attempt already ended at the control plane. */
  ended: "lease_candidate_ended",
  /** The probe could not complete; nothing was renewed, the reaper ends the attempt. */
  unreachable: "lease_candidate_unreachable",
} as const;

/** The store could not be read or a row did not decode to the offer its key names. */
export class LeaseCandidateStoreCorruptError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LeaseCandidateStoreCorruptError";
  }
}

/** The narrow write surface the poll loop needs (write before ACK, prune on settle). */
export interface LeaseCandidateWriter {
  put(offer: LeaseOfferV1): void;
  remove(leaseId: string): void;
}

export interface LeaseCandidateStore extends LeaseCandidateWriter {
  /** Every stored candidate. Throws {@link LeaseCandidateStoreCorruptError} rather than
   * returning a partial list when ANY row cannot be decoded. */
  list(): LeaseOfferV1[];
  /** Drop every row — used once an unreadable store has been reported, so the same
   * unaccountable rows are not re-read (and re-reported) on every later boot. */
  clear(): void;
  close(): void;
}

export interface LeaseCandidateStoreOptions {
  readonly path: string;
  readonly now?: () => number;
}

type DatabaseSyncCtor = new (path: string) => DatabaseSync;

/** Open the `node:sqlite`-backed store. A file that is not a database rejects with
 * {@link LeaseCandidateStoreCorruptError} (the caller sets it aside and opens fresh). */
export async function openLeaseCandidateStore(opts: LeaseCandidateStoreOptions): Promise<SqliteLeaseCandidateStore> {
  const ctor = await loadDatabaseSync();
  return new SqliteLeaseCandidateStore(ctor, opts);
}

export interface OpenedLeaseCandidateStore {
  /** The usable store, or `null` when even a fresh file could not be opened. */
  readonly store: LeaseCandidateStore | null;
  /** The fault that made the EXISTING file unreadable, or `null` when it opened cleanly. */
  readonly unreadable: unknown;
  /** Where the unreadable file was moved, when it could be moved. */
  readonly setAsidePath: string | null;
}

/**
 * Open the store at boot, failing CLOSED on an unreadable file without blocking boot.
 *
 * A file that will not open is never read and never overwritten in place: it is renamed
 * aside (`<path>.corrupt-<ms>`, kept for an operator) and a fresh store is opened so this
 * lifetime's ACKs are still recorded. The fault is RETURNED, not thrown — the composed
 * startup reconcile logs it under {@link LEASE_CANDIDATE_REASONS.unreadable} and probes
 * nothing, which is what "no renewal for a lease it cannot account for" means.
 */
export async function openLeaseCandidateStoreFailClosed(opts: {
  readonly path: string;
  readonly open?: (o: LeaseCandidateStoreOptions) => Promise<LeaseCandidateStore>;
  readonly now?: () => number;
}): Promise<OpenedLeaseCandidateStore> {
  const open = opts.open ?? openLeaseCandidateStore;
  const now = opts.now ?? (() => Date.now());
  try {
    return { store: await open({ path: opts.path }), unreadable: null, setAsidePath: null };
  } catch (unreadable) {
    let setAsidePath: string | null = `${opts.path}.corrupt-${now()}`;
    try {
      renameSync(opts.path, setAsidePath);
    } catch {
      setAsidePath = null;
    }
    try {
      return { store: await open({ path: opts.path }), unreadable, setAsidePath };
    } catch {
      return { store: null, unreadable, setAsidePath };
    }
  }
}

interface RawCandidateRow {
  lease_id: string;
  organization_id: string;
  offer_json: string;
}

export class SqliteLeaseCandidateStore implements LeaseCandidateStore {
  readonly #db: DatabaseSync;
  readonly #now: () => number;

  constructor(DatabaseSyncCtor: DatabaseSyncCtor, opts: LeaseCandidateStoreOptions) {
    this.#now = opts.now ?? (() => Date.now());
    let db: DatabaseSync;
    try {
      db = new DatabaseSyncCtor(opts.path);
    } catch (err) {
      throw new LeaseCandidateStoreCorruptError("lease-candidate store could not be opened", { cause: err });
    }
    this.#db = db;
    // Mirrors the event outbox: a post-open fault (SQLITE_NOTADB on the first statement)
    // must not leak the handle and its file lock. Close, then fail closed by name.
    try {
      this.#db.exec("PRAGMA journal_mode = TRUNCATE;");
      this.#db.exec("PRAGMA synchronous = FULL;");
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS lease_candidate (
          lease_id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          job_id TEXT NOT NULL,
          attempt INTEGER NOT NULL,
          offer_json TEXT NOT NULL,
          stored_at INTEGER NOT NULL
        );
      `);
      // Force a read of the schema so a garbage file fails HERE, not at the first list().
      this.#db.prepare("SELECT COUNT(*) AS c FROM lease_candidate").get();
    } catch (err) {
      try {
        this.#db.close();
      } catch {
        // never mask the original fault
      }
      throw new LeaseCandidateStoreCorruptError("lease-candidate store is not a readable database", { cause: err });
    }
    if (opts.path !== ":memory:") {
      try {
        chmodSync(opts.path, 0o600);
      } catch {
        // Windows cannot clear group/other bits; the default ACL holds there (as the outbox).
      }
    }
  }

  put(offer: LeaseOfferV1): void {
    // synchronous=FULL: the row is on disk before this returns, so a crash after the ACK
    // and after this line always leaves the candidate for the next boot.
    this.#db
      .prepare(
        `INSERT INTO lease_candidate (lease_id, organization_id, job_id, attempt, offer_json, stored_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(lease_id) DO UPDATE SET
           organization_id = excluded.organization_id, job_id = excluded.job_id,
           attempt = excluded.attempt, offer_json = excluded.offer_json, stored_at = excluded.stored_at`,
      )
      .run(
        String(offer.leaseId),
        String(offer.job.organizationId),
        String(offer.job.jobId),
        offer.job.attempt,
        JSON.stringify(offer),
        this.#now(),
      );
  }

  remove(leaseId: string): void {
    this.#db.prepare(`DELETE FROM lease_candidate WHERE lease_id = ?`).run(leaseId);
  }

  list(): LeaseOfferV1[] {
    let rows: RawCandidateRow[];
    try {
      rows = this.#db
        .prepare(`SELECT lease_id, organization_id, offer_json FROM lease_candidate ORDER BY stored_at ASC, lease_id ASC`)
        .all() as unknown as RawCandidateRow[];
    } catch (err) {
      throw new LeaseCandidateStoreCorruptError("lease-candidate store could not be read", { cause: err });
    }
    const offers: LeaseOfferV1[] = [];
    for (const row of rows) {
      let json: unknown;
      try {
        json = JSON.parse(row.offer_json);
      } catch (err) {
        throw new LeaseCandidateStoreCorruptError("a lease-candidate row is not valid JSON", { cause: err });
      }
      const parsed = leaseOfferV1Schema.safeParse(json);
      // A row must decode to the offer its KEY names, under the Organization it was stored
      // for — otherwise one lease could be probed under another's identity.
      if (
        !parsed.success ||
        String(parsed.data.leaseId) !== row.lease_id ||
        String(parsed.data.job.organizationId) !== row.organization_id
      ) {
        throw new LeaseCandidateStoreCorruptError("a lease-candidate row does not decode to the lease it is keyed by");
      }
      offers.push(parsed.data);
    }
    return offers;
  }

  clear(): void {
    this.#db.prepare(`DELETE FROM lease_candidate`).run();
  }

  close(): void {
    this.#db.close();
  }
}
