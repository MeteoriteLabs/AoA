import { createGzip } from "node:zlib";
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { resolve } from "node:path";
import postgres from "postgres";
import type { BackupRetentionPolicy } from "@armyofagents/shared";
import { DEFAULT_BACKUP_RETENTION } from "@armyofagents/shared";

export type RunDatabaseBackupOptions = {
  connectionString: string;
  backupDir: string;
  retention?: BackupRetentionPolicy;
  /** @deprecated Use `retention` instead. Ignored when `retention` is provided. */
  retentionDays?: number;
  filenamePrefix?: string;
  connectTimeoutSeconds?: number;
};

export type RunDatabaseBackupResult = {
  backupFile: string;
  sizeBytes: number;
  prunedCount: number;
};

function timestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

// ── Tiered retention helpers ──────────────────────────────────────────────────

function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((+date - +yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function calendarMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Pure tiered retention pruning. Given a list of backup entries, returns
 * which paths to keep and which to remove according to the policy.
 *
 * Tiers:
 *   - Daily:   keep the newest backup per calendar day for the last `dailyDays` days.
 *   - Weekly:  keep the newest backup per ISO week for the next `weeklyWeeks` weeks beyond the daily window.
 *   - Monthly: keep the newest backup per calendar month for the next `monthlyMonths` months beyond the weekly window.
 *   - Anything older than the monthly window is pruned.
 */
export function pruneOldBackups(
  backups: Array<{ path: string; createdAt: Date }>,
  policy: BackupRetentionPolicy,
  now: Date = new Date(),
): { keep: string[]; remove: string[] } {
  const sorted = [...backups].sort((a, b) => +b.createdAt - +a.createdAt);
  const keep = new Set<string>();

  // Daily tier: newest backup per day for last N days
  const dayCutoff = new Date(now);
  dayCutoff.setUTCDate(dayCutoff.getUTCDate() - policy.dailyDays);
  const seenDays = new Set<string>();
  for (const b of sorted) {
    if (b.createdAt < dayCutoff) break;
    const dayKey = b.createdAt.toISOString().slice(0, 10);
    if (!seenDays.has(dayKey)) {
      seenDays.add(dayKey);
      keep.add(b.path);
    }
  }

  // Weekly tier: newest per ISO-week for next N weeks beyond the daily window
  const weekCutoff = new Date(dayCutoff);
  weekCutoff.setUTCDate(weekCutoff.getUTCDate() - policy.weeklyWeeks * 7);
  const seenWeeks = new Set<string>();
  for (const b of sorted) {
    if (b.createdAt >= dayCutoff || b.createdAt < weekCutoff) continue;
    const weekKey = isoWeek(b.createdAt);
    if (!seenWeeks.has(weekKey)) {
      seenWeeks.add(weekKey);
      keep.add(b.path);
    }
  }

  // Monthly tier: newest per calendar-month for next N months beyond the weekly window
  const monthCutoff = new Date(weekCutoff);
  monthCutoff.setUTCMonth(monthCutoff.getUTCMonth() - policy.monthlyMonths);
  const seenMonths = new Set<string>();
  for (const b of sorted) {
    if (b.createdAt >= weekCutoff || b.createdAt < monthCutoff) continue;
    const monthKey = calendarMonth(b.createdAt);
    if (!seenMonths.has(monthKey)) {
      seenMonths.add(monthKey);
      keep.add(b.path);
    }
  }

  const remove = sorted.filter((b) => !keep.has(b.path)).map((b) => b.path);
  return { keep: [...keep], remove };
}

// ── Filesystem-level pruning (uses tiered policy on .sql and .sql.gz files) ───

function pruneBackupFiles(backupDir: string, policy: BackupRetentionPolicy, filenamePrefix: string): number {
  if (!existsSync(backupDir)) return 0;

  const backups: Array<{ path: string; createdAt: Date }> = [];

  for (const name of readdirSync(backupDir)) {
    const isSql = name.startsWith(`${filenamePrefix}-`) && name.endsWith(".sql");
    const isGz = name.startsWith(`${filenamePrefix}-`) && name.endsWith(".sql.gz");
    if (!isSql && !isGz) continue;
    const fullPath = resolve(backupDir, name);
    const stat = statSync(fullPath);
    backups.push({ path: fullPath, createdAt: new Date(stat.mtimeMs) });
  }

  if (backups.length === 0) return 0;

  const { remove } = pruneOldBackups(backups, policy);
  for (const p of remove) {
    unlinkSync(p);
  }
  return remove.length;
}

function formatBackupSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes}B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)}K`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)}M`;
}

export async function runDatabaseBackup(opts: RunDatabaseBackupOptions): Promise<RunDatabaseBackupResult> {
  const filenamePrefix = opts.filenamePrefix ?? "aoa";
  // Resolve retention policy: prefer structured policy, fall back to a
  // simple daily-only policy derived from the legacy retentionDays number.
  const retention: BackupRetentionPolicy = opts.retention ?? (
    opts.retentionDays != null
      ? { dailyDays: Math.min(Math.max(3, Math.trunc(opts.retentionDays)), 14) as (typeof DEFAULT_BACKUP_RETENTION)["dailyDays"], weeklyWeeks: DEFAULT_BACKUP_RETENTION.weeklyWeeks, monthlyMonths: DEFAULT_BACKUP_RETENTION.monthlyMonths }
      : DEFAULT_BACKUP_RETENTION
  );
  const connectTimeout = Math.max(1, Math.trunc(opts.connectTimeoutSeconds ?? 5));
  const sql = postgres(opts.connectionString, { max: 1, connect_timeout: connectTimeout });

  try {
    await sql`SELECT 1`;

    const lines: string[] = [];
    const emit = (line: string) => lines.push(line);

    emit("-- AoA database backup");
    emit(`-- Created: ${new Date().toISOString()}`);
    emit("");
    emit("BEGIN;");
    emit("");

    // Get all enums
    const enums = await sql<{ typname: string; labels: string[] }[]>`
      SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      JOIN pg_namespace n ON t.typnamespace = n.oid
      WHERE n.nspname = 'public'
      GROUP BY t.typname
      ORDER BY t.typname
    `;

    for (const e of enums) {
      const labels = e.labels.map((l) => `'${l.replace(/'/g, "''")}'`).join(", ");
      emit(`CREATE TYPE "public"."${e.typname}" AS ENUM (${labels});`);
    }
    if (enums.length > 0) emit("");

    // Get tables in dependency order (referenced tables first)
    const tables = await sql<{ tablename: string }[]>`
      SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname != '__drizzle_migrations'
      ORDER BY c.relname
    `;

    // Get full CREATE TABLE DDL via column info
    for (const { tablename } of tables) {
      const columns = await sql<{
        column_name: string;
        data_type: string;
        udt_name: string;
        is_nullable: string;
        column_default: string | null;
        character_maximum_length: number | null;
        numeric_precision: number | null;
        numeric_scale: number | null;
      }[]>`
        SELECT column_name, data_type, udt_name, is_nullable, column_default,
               character_maximum_length, numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${tablename}
        ORDER BY ordinal_position
      `;

      emit(`-- Table: ${tablename}`);
      emit(`DROP TABLE IF EXISTS "${tablename}" CASCADE;`);

      const colDefs: string[] = [];
      for (const col of columns) {
        let typeStr: string;
        if (col.data_type === "USER-DEFINED") {
          typeStr = `"${col.udt_name}"`;
        } else if (col.data_type === "ARRAY") {
          typeStr = `${col.udt_name.replace(/^_/, "")}[]`;
        } else if (col.data_type === "character varying") {
          typeStr = col.character_maximum_length
            ? `varchar(${col.character_maximum_length})`
            : "varchar";
        } else if (col.data_type === "numeric" && col.numeric_precision != null) {
          typeStr =
            col.numeric_scale != null
              ? `numeric(${col.numeric_precision}, ${col.numeric_scale})`
              : `numeric(${col.numeric_precision})`;
        } else {
          typeStr = col.data_type;
        }

        let def = `  "${col.column_name}" ${typeStr}`;
        if (col.column_default != null) def += ` DEFAULT ${col.column_default}`;
        if (col.is_nullable === "NO") def += " NOT NULL";
        colDefs.push(def);
      }

      // Primary key
      const pk = await sql<{ constraint_name: string; column_names: string[] }[]>`
        SELECT c.conname AS constraint_name,
               array_agg(a.attname ORDER BY array_position(c.conkey, a.attnum)) AS column_names
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
        WHERE n.nspname = 'public' AND t.relname = ${tablename} AND c.contype = 'p'
        GROUP BY c.conname
      `;
      for (const p of pk) {
        const cols = p.column_names.map((c) => `"${c}"`).join(", ");
        colDefs.push(`  CONSTRAINT "${p.constraint_name}" PRIMARY KEY (${cols})`);
      }

      emit(`CREATE TABLE "${tablename}" (`);
      emit(colDefs.join(",\n"));
      emit(");");
      emit("");
    }

    // Foreign keys (after all tables created)
    const fks = await sql<{
      constraint_name: string;
      source_table: string;
      source_columns: string[];
      target_table: string;
      target_columns: string[];
      update_rule: string;
      delete_rule: string;
    }[]>`
      SELECT
        c.conname AS constraint_name,
        src.relname AS source_table,
        array_agg(sa.attname ORDER BY array_position(c.conkey, sa.attnum)) AS source_columns,
        tgt.relname AS target_table,
        array_agg(ta.attname ORDER BY array_position(c.confkey, ta.attnum)) AS target_columns,
        CASE c.confupdtype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS update_rule,
        CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS delete_rule
      FROM pg_constraint c
      JOIN pg_class src ON src.oid = c.conrelid
      JOIN pg_class tgt ON tgt.oid = c.confrelid
      JOIN pg_namespace n ON n.oid = src.relnamespace
      JOIN pg_attribute sa ON sa.attrelid = src.oid AND sa.attnum = ANY(c.conkey)
      JOIN pg_attribute ta ON ta.attrelid = tgt.oid AND ta.attnum = ANY(c.confkey)
      WHERE c.contype = 'f' AND n.nspname = 'public'
      GROUP BY c.conname, src.relname, tgt.relname, c.confupdtype, c.confdeltype
      ORDER BY src.relname, c.conname
    `;

    if (fks.length > 0) {
      emit("-- Foreign keys");
      for (const fk of fks) {
        const srcCols = fk.source_columns.map((c) => `"${c}"`).join(", ");
        const tgtCols = fk.target_columns.map((c) => `"${c}"`).join(", ");
        emit(
          `ALTER TABLE "${fk.source_table}" ADD CONSTRAINT "${fk.constraint_name}" FOREIGN KEY (${srcCols}) REFERENCES "${fk.target_table}" (${tgtCols}) ON UPDATE ${fk.update_rule} ON DELETE ${fk.delete_rule};`,
        );
      }
      emit("");
    }

    // Unique constraints
    const uniques = await sql<{
      constraint_name: string;
      tablename: string;
      column_names: string[];
    }[]>`
      SELECT c.conname AS constraint_name,
             t.relname AS tablename,
             array_agg(a.attname ORDER BY array_position(c.conkey, a.attnum)) AS column_names
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
      WHERE n.nspname = 'public' AND c.contype = 'u'
      GROUP BY c.conname, t.relname
      ORDER BY t.relname, c.conname
    `;

    if (uniques.length > 0) {
      emit("-- Unique constraints");
      for (const u of uniques) {
        const cols = u.column_names.map((c) => `"${c}"`).join(", ");
        emit(`ALTER TABLE "${u.tablename}" ADD CONSTRAINT "${u.constraint_name}" UNIQUE (${cols});`);
      }
      emit("");
    }

    // Indexes (non-primary, non-unique-constraint)
    const indexes = await sql<{ indexdef: string }[]>`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname NOT IN (
          SELECT conname FROM pg_constraint
          WHERE connamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        )
      ORDER BY tablename, indexname
    `;

    if (indexes.length > 0) {
      emit("-- Indexes");
      for (const idx of indexes) {
        emit(`${idx.indexdef};`);
      }
      emit("");
    }

    // Dump data for each table
    for (const { tablename } of tables) {
      const count = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ${sql(tablename)}
      `;
      if ((count[0]?.n ?? 0) === 0) continue;

      // Get column info for this table
      const cols = await sql<{ column_name: string; data_type: string }[]>`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${tablename}
        ORDER BY ordinal_position
      `;
      const colNames = cols.map((c) => `"${c.column_name}"`).join(", ");

      emit(`-- Data for: ${tablename} (${count[0]!.n} rows)`);

      const rows = await sql`SELECT * FROM ${sql(tablename)}`.values();
      for (const row of rows) {
        const values = row.map((val: unknown) => {
          if (val === null || val === undefined) return "NULL";
          if (typeof val === "boolean") return val ? "true" : "false";
          if (typeof val === "number") return String(val);
          if (val instanceof Date) return `'${val.toISOString()}'`;
          if (typeof val === "object") return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
          return `'${String(val).replace(/'/g, "''")}'`;
        });
        emit(`INSERT INTO "${tablename}" (${colNames}) VALUES (${values.join(", ")});`);
      }
      emit("");
    }

    // Sequence values
    const sequences = await sql<{ sequence_name: string }[]>`
      SELECT sequence_name
      FROM information_schema.sequences
      WHERE sequence_schema = 'public'
      ORDER BY sequence_name
    `;

    if (sequences.length > 0) {
      emit("-- Sequence values");
      for (const seq of sequences) {
        const val = await sql<{ last_value: string }[]>`
          SELECT last_value::text FROM ${sql(seq.sequence_name)}
        `;
        if (val[0]) {
          emit(`SELECT setval('"${seq.sequence_name}"', ${val[0].last_value});`);
        }
      }
      emit("");
    }

    emit("COMMIT;");
    emit("");

    // Write the backup file as gzip-compressed .sql.gz
    mkdirSync(opts.backupDir, { recursive: true });
    const backupFile = resolve(opts.backupDir, `${filenamePrefix}-${timestamp()}.sql.gz`);

    // Compress the SQL text through gzip. On failure, clean up the partial file.
    const sqlText = lines.join("\n");
    try {
      await pipeline(
        Readable.from([sqlText]),
        createGzip(),
        createWriteStream(backupFile),
      );
    } catch (gzipErr) {
      // Clean up any partial .sql.gz file left by a failed pipeline
      try {
        if (existsSync(backupFile)) unlinkSync(backupFile);
      } catch {
        // best-effort cleanup; suppress secondary errors
      }
      throw gzipErr;
    }

    const sizeBytes = statSync(backupFile).size;
    const prunedCount = pruneBackupFiles(opts.backupDir, retention, filenamePrefix);

    return {
      backupFile,
      sizeBytes,
      prunedCount,
    };
  } finally {
    await sql.end();
  }
}

export function formatDatabaseBackupResult(result: RunDatabaseBackupResult): string {
  const size = formatBackupSize(result.sizeBytes);
  const pruned = result.prunedCount > 0 ? `; pruned ${result.prunedCount} old backup(s)` : "";
  return `${result.backupFile} (${size}${pruned})`;
}
