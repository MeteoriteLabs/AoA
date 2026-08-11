import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const METRICS_TYPES_COMPILER_FIXTURE = String.raw`
import type {
  JobControlMetrics,
  SchedulerCapacityScope,
} from "../../services/job-control-metrics.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;
type Assert<Condition extends true> = Condition;

type PlanJobControlMetrics = {
  certificateScan(value: Readonly<{
    hitsObserved: number;
    hitsSaturated: boolean;
    missesObserved: number;
    missesSaturated: boolean;
    scanExhausted: boolean;
    cardinalityObserved: number;
    cardinalitySaturated: boolean;
  }>): void;
  certificateUpsert(value: Readonly<{ count: number }>): void;
  certificateCleanup(value: Readonly<{
    count: number;
    cardinalityObserved: number;
    cardinalitySaturated: boolean;
  }>): void;
  headRestart(): void;
  schedulerCapacityReject(value: Readonly<{
    scope: "organization" | "target" | "global";
  }>): void;
  schedulerExpiry(value: Readonly<{ count: number }>): void;
  schedulerCardinality(value: Readonly<{
    organizations: number;
    targets: number;
    signals: number;
  }>): void;
  outboxTick(value: Readonly<{
    budgetMs: number;
    elapsedMs: number;
    overshootMs: number;
    organizations: number;
    claimed: number;
    delivered: number;
    cleaned: number;
  }>): void;
};

type _MetricsAreBidirectionallyExact = Assert<Equal<JobControlMetrics, PlanJobControlMetrics>>;
type _ScopeIsBidirectionallyExact = Assert<
  Equal<SchedulerCapacityScope, "organization" | "target" | "global">
>;
type _MetricsHaveNoOpenStringIndex = Assert<Equal<string extends keyof JobControlMetrics ? true : false, false>>;

declare const metrics: JobControlMetrics;
declare const openRecord: Record<string, unknown>;

metrics.certificateScan({
  hitsObserved: 1,
  hitsSaturated: false,
  missesObserved: 2,
  missesSaturated: false,
  scanExhausted: false,
  cardinalityObserved: 3,
  cardinalitySaturated: false,
});
metrics.schedulerCapacityReject({ scope: "organization" });

// @ts-expect-error The exact upsert payload is closed to caller-defined fields.
metrics.certificateUpsert({ count: 1, organizationId: "forbidden" });
// @ts-expect-error An open Record cannot stand in for a closed scan payload.
metrics.certificateScan(openRecord);
// @ts-expect-error Scheduler scope is the exact three-value plan union.
const invalidScope: SchedulerCapacityScope = "tenant";

void invalidScope;
`;

const METRICS_TYPES_EXPECTED_MODULE = String.raw`
export type SchedulerCapacityScope = "organization" | "target" | "global";
export interface JobControlMetrics {
  certificateScan(value: Readonly<{
    hitsObserved: number;
    hitsSaturated: boolean;
    missesObserved: number;
    missesSaturated: boolean;
    scanExhausted: boolean;
    cardinalityObserved: number;
    cardinalitySaturated: boolean;
  }>): void;
  certificateUpsert(value: Readonly<{ count: number }>): void;
  certificateCleanup(value: Readonly<{
    count: number;
    cardinalityObserved: number;
    cardinalitySaturated: boolean;
  }>): void;
  headRestart(): void;
  schedulerCapacityReject(value: Readonly<{ scope: SchedulerCapacityScope }>): void;
  schedulerExpiry(value: Readonly<{ count: number }>): void;
  schedulerCardinality(value: Readonly<{
    organizations: number;
    targets: number;
    signals: number;
  }>): void;
  outboxTick(value: Readonly<{
    budgetMs: number;
    elapsedMs: number;
    overshootMs: number;
    organizations: number;
    claimed: number;
    delivered: number;
    cleaned: number;
  }>): void;
}
`;

type CertificateScanMetrics = Readonly<{
  hitsObserved: number;
  hitsSaturated: boolean;
  missesObserved: number;
  missesSaturated: boolean;
  scanExhausted: boolean;
  cardinalityObserved: number;
  cardinalitySaturated: boolean;
}>;
type CertificateUpsertMetrics = Readonly<{ count: number }>;
type CertificateCleanupMetrics = Readonly<{
  count: number;
  cardinalityObserved: number;
  cardinalitySaturated: boolean;
}>;
type SchedulerCapacityRejectMetrics = Readonly<{ scope: "organization" | "target" | "global" }>;
type SchedulerExpiryMetrics = Readonly<{ count: number }>;
type SchedulerCardinalityMetrics = Readonly<{ organizations: number; targets: number; signals: number }>;
type OutboxTickMetrics = Readonly<{
  budgetMs: number;
  elapsedMs: number;
  overshootMs: number;
  organizations: number;
  claimed: number;
  delivered: number;
  cleaned: number;
}>;

type RuntimeMetrics = {
  certificateScan(value: CertificateScanMetrics): void;
  certificateUpsert(value: CertificateUpsertMetrics): void;
  certificateCleanup(value: CertificateCleanupMetrics): void;
  headRestart(): void;
  schedulerCapacityReject(value: SchedulerCapacityRejectMetrics): void;
  schedulerExpiry(value: SchedulerExpiryMetrics): void;
  schedulerCardinality(value: SchedulerCardinalityMetrics): void;
  outboxTick(value: OutboxTickMetrics): void;
};

type RuntimeMetricsModule = {
  NOOP_JOB_CONTROL_METRICS: RuntimeMetrics;
  createPinoJobControlMetrics(log: { info(...args: unknown[]): void }): RuntimeMetrics;
};

function isMetricsModule(value: unknown): value is RuntimeMetricsModule {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RuntimeMetricsModule>;
  return typeof candidate.createPinoJobControlMetrics === "function" &&
    !!candidate.NOOP_JOB_CONTROL_METRICS &&
    ["certificateScan", "certificateUpsert", "certificateCleanup", "headRestart",
      "schedulerCapacityReject", "schedulerExpiry", "schedulerCardinality", "outboxTick"]
      .every((method) => typeof (candidate.NOOP_JOB_CONTROL_METRICS as unknown as
        Record<string, unknown>)[method] === "function");
}

async function loadMetricsModule(): Promise<unknown> {
  const moduleSpecifier: string = "../services/job-control-metrics.js";
  try {
    return await import(moduleSpecifier);
  } catch {
    return null;
  }
}

describe("JOB-003 closed payload-free metrics", () => {
  it("compiler-binds the exported metrics and scope types to the exact closed plan contract", () => {
    // Mutation caught: an exported open Record, an added field/method, or a widened scheduler
    // scope makes this independent fixture fail even if the source-shape inspection below passes.
    const fixturePath = fileURLToPath(new URL(
      "./fixtures/job-control-metrics-types.virtual.ts",
      import.meta.url,
    ));
    const canonicalFixturePath = ts.sys.resolvePath(fixturePath);
    const modulePath = fileURLToPath(new URL("../services/job-control-metrics.ts", import.meta.url));
    const canonicalModulePath = ts.sys.resolvePath(modulePath);
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
      lib: ["lib.es2023.d.ts"],
    };
    const compile = (expectedModuleSource?: string) => {
      const host = ts.createCompilerHost(options);
      const originalFileExists = host.fileExists.bind(host);
      const originalReadFile = host.readFile.bind(host);
      const originalGetSourceFile = host.getSourceFile.bind(host);
      const virtualSource = (fileName: string) => {
        const canonical = ts.sys.resolvePath(fileName);
        if (canonical === canonicalFixturePath) return METRICS_TYPES_COMPILER_FIXTURE;
        if (expectedModuleSource !== undefined && canonical === canonicalModulePath) {
          return expectedModuleSource;
        }
        return undefined;
      };
      host.fileExists = (fileName) => virtualSource(fileName) !== undefined || originalFileExists(fileName);
      host.readFile = (fileName) => virtualSource(fileName) ?? originalReadFile(fileName);
      host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
        const sourceText = virtualSource(fileName);
        return sourceText !== undefined
          ? ts.createSourceFile(fileName, sourceText, languageVersion, true)
          : originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
      };
      const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram({
        rootNames: [fixturePath],
        options,
        host,
      }));
      return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => fileURLToPath(new URL("../../..", import.meta.url)),
        getNewLine: () => "\n",
      });
    };
    expect(compile(METRICS_TYPES_EXPECTED_MODULE), "compiler fixture must accept the exact plan type")
      .toBe("");
    expect(compile(), "production exports must satisfy the validated compiler fixture").toBe("");
  });

  it("emits the eight exact event names with only their closed hand-derived fields", async () => {
    // Mutation caught: adding arbitrary labels/payloads or inferring counts in the adapter makes
    // a domain canary observable even though the service result is otherwise unchanged.
    const loaded = await loadMetricsModule();
    expect(loaded).not.toBeNull();
    expect(isMetricsModule(loaded)).toBe(true);
    if (!isMetricsModule(loaded)) return;
    const records: unknown[][] = [];
    const metrics = loaded.createPinoJobControlMetrics({
      info: (...args) => { records.push(args); },
    });
    const forbidden = "JOB003_SECRET_URL_worker_attempt_hash_reason_sql";

    metrics.certificateScan({
      hitsObserved: 3,
      hitsSaturated: false,
      missesObserved: 5,
      missesSaturated: true,
      scanExhausted: true,
      cardinalityObserved: 7,
      cardinalitySaturated: false,
      organizationId: forbidden,
    } as CertificateScanMetrics);
    metrics.certificateUpsert({ count: 11, input: forbidden } as CertificateUpsertMetrics);
    metrics.certificateCleanup({
      count: 13,
      cardinalityObserved: 17,
      cardinalitySaturated: true,
      reason: forbidden,
    } as CertificateCleanupMetrics);
    metrics.headRestart();
    metrics.schedulerCapacityReject({ scope: "target", targetId: forbidden } as SchedulerCapacityRejectMetrics);
    metrics.schedulerExpiry({ count: 19, error: forbidden } as SchedulerExpiryMetrics);
    metrics.schedulerCardinality({ organizations: 2, targets: 23, signals: 29, sql: forbidden } as SchedulerCardinalityMetrics);
    metrics.outboxTick({
      budgetMs: 600,
      elapsedMs: 650,
      overshootMs: 50,
      organizations: 3,
      claimed: 31,
      delivered: 37,
      cleaned: 41,
      credential: forbidden,
    } as OutboxTickMetrics);

    expect(records).toEqual([
      [{ event: "job_control.certificate_scan", hitsObserved: 3, hitsSaturated: false,
        missesObserved: 5, missesSaturated: true, scanExhausted: true,
        cardinalityObserved: 7, cardinalitySaturated: false }],
      [{ event: "job_control.certificate_upsert", count: 11 }],
      [{ event: "job_control.certificate_cleanup", count: 13,
        cardinalityObserved: 17, cardinalitySaturated: true }],
      [{ event: "job_control.head_restart" }],
      [{ event: "job_control.scheduler_capacity_reject", scope: "target" }],
      [{ event: "job_control.scheduler_expiry", count: 19 }],
      [{ event: "job_control.scheduler_cardinality", organizations: 2, targets: 23, signals: 29 }],
      [{ event: "job_control.outbox_tick", budgetMs: 600, elapsedMs: 650, overshootMs: 50,
        organizations: 3, claimed: 31, delivered: 37, cleaned: 41 }],
    ]);
    expect(JSON.stringify(records)).not.toContain(forbidden);
  });

  it("freezes the no-op singleton and isolates every logger failure from control flow", async () => {
    const loaded = await loadMetricsModule();
    expect(loaded).not.toBeNull();
    expect(isMetricsModule(loaded)).toBe(true);
    if (!isMetricsModule(loaded)) return;
    expect(Object.isFrozen(loaded.NOOP_JOB_CONTROL_METRICS)).toBe(true);
    for (const method of Object.values(loaded.NOOP_JOB_CONTROL_METRICS)) {
      expect(() => (method as (value?: unknown) => void)({ count: 1 })).not.toThrow();
    }

    const metrics = loaded.createPinoJobControlMetrics({ info: vi.fn(() => {
      throw new Error("logger unavailable");
    }) });
    const everyMethod: Array<() => void> = [
      () => metrics.certificateScan({ hitsObserved: 1, hitsSaturated: false,
        missesObserved: 2, missesSaturated: false, scanExhausted: false,
        cardinalityObserved: 3, cardinalitySaturated: false }),
      () => metrics.certificateUpsert({ count: 1 }),
      () => metrics.certificateCleanup({ count: 1, cardinalityObserved: 2, cardinalitySaturated: false }),
      () => metrics.headRestart(),
      () => metrics.schedulerCapacityReject({ scope: "global" }),
      () => metrics.schedulerExpiry({ count: 1 }),
      () => metrics.schedulerCardinality({ organizations: 1, targets: 2, signals: 3 }),
      () => metrics.outboxTick({ budgetMs: 1, elapsedMs: 1, overshootMs: 0,
        organizations: 0, claimed: 0, delivered: 0, cleaned: 0 }),
    ];
    for (const call of everyMethod) expect(call).not.toThrow();
  });

  it("clamps invalid numeric values and rejects the open scheduler scope", async () => {
    const loaded = await loadMetricsModule();
    expect(loaded).not.toBeNull();
    expect(isMetricsModule(loaded)).toBe(true);
    if (!isMetricsModule(loaded)) return;
    const records: unknown[][] = [];
    const metrics = loaded.createPinoJobControlMetrics({ info: (...args) => { records.push(args); } });
    metrics.schedulerCapacityReject({ scope: "tenant" } as unknown as SchedulerCapacityRejectMetrics);
    metrics.schedulerExpiry({ count: -1 });
    metrics.schedulerCardinality({ organizations: Number.NaN, targets: 1.5, signals: Number.POSITIVE_INFINITY });
    metrics.outboxTick({ budgetMs: -1, elapsedMs: Number.MAX_SAFE_INTEGER + 1,
      overshootMs: Number.NaN, organizations: -2, claimed: 1.5,
      delivered: Number.NEGATIVE_INFINITY, cleaned: 3 });

    expect(records).toEqual([
      [{ event: "job_control.scheduler_capacity_reject", scope: "global" }],
      [{ event: "job_control.scheduler_expiry", count: 0 }],
      [{ event: "job_control.scheduler_cardinality", organizations: 0, targets: 1, signals: 0 }],
      [{ event: "job_control.outbox_tick", budgetMs: 0, elapsedMs: Number.MAX_SAFE_INTEGER,
        overshootMs: 0, organizations: 0, claimed: 1, delivered: 0, cleaned: 3 }],
    ]);
  });

  it("keeps the metrics implementation free of open payload and identity vocabulary", async () => {
    const sourceUrl = new URL("../services/job-control-metrics.ts", import.meta.url);
    let source: string | null = null;
    try { source = readFileSync(sourceUrl, "utf8"); } catch { /* assertion below owns RED */ }
    expect(source).not.toBeNull();
    if (source === null) return;
    for (const forbidden of [
      "organizationId", "companyId", "workerId", "targetId", "jobId", "attemptId",
      "leaseId", "hash", "reason", "error", "stack", "sql", "credential", "url", "input",
    ]) {
      expect(source).not.toMatch(new RegExp(`\\b${forbidden}\\b`, "i"));
    }
  });

  it("exports the exact closed compiler-visible JobControlMetrics argument types", () => {
    const sourceUrl = new URL("../services/job-control-metrics.ts", import.meta.url);
    let sourceText: string | null = null;
    try { sourceText = readFileSync(sourceUrl, "utf8"); } catch { /* assertion owns missing module */ }
    expect(sourceText).not.toBeNull();
    if (sourceText === null) return;
    const source = ts.createSourceFile(
      "job-control-metrics.ts", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
    );
    const interfaceNode = source.statements.find((statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === "JobControlMetrics");
    expect(interfaceNode).toBeDefined();
    if (!interfaceNode) return;
    expect(interfaceNode.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)).toBe(true);
    expect(interfaceNode.members.some(ts.isIndexSignatureDeclaration)).toBe(false);
    const expectedParameters: Record<string, readonly string[] | null> = {
      certificateScan: ["hitsObserved:number", "hitsSaturated:boolean", "missesObserved:number",
        "missesSaturated:boolean", "scanExhausted:boolean", "cardinalityObserved:number",
        "cardinalitySaturated:boolean"],
      certificateUpsert: ["count:number"],
      certificateCleanup: ["count:number", "cardinalityObserved:number", "cardinalitySaturated:boolean"],
      headRestart: null,
      schedulerCapacityReject: ["scope:SchedulerCapacityScope"],
      schedulerExpiry: ["count:number"],
      schedulerCardinality: ["organizations:number", "targets:number", "signals:number"],
      outboxTick: ["budgetMs:number", "elapsedMs:number", "overshootMs:number", "organizations:number",
        "claimed:number", "delivered:number", "cleaned:number"],
    };
    expect(interfaceNode.members).toHaveLength(Object.keys(expectedParameters).length);
    for (const member of interfaceNode.members) {
      expect(ts.isMethodSignature(member)).toBe(true);
      if (!ts.isMethodSignature(member) || !member.name || !ts.isIdentifier(member.name)) continue;
      const expected = expectedParameters[member.name.text];
      expect(expected, `unexpected method ${member.name.text}`).not.toBeUndefined();
      expect(member.type?.getText(source)).toBe("void");
      if (expected === null) {
        expect(member.parameters).toHaveLength(0);
        continue;
      }
      expect(member.parameters).toHaveLength(1);
      const parameterType = member.parameters[0]?.type;
      expect(parameterType && ts.isTypeLiteralNode(parameterType)).toBe(true);
      if (!parameterType || !ts.isTypeLiteralNode(parameterType)) continue;
      expect(parameterType.members.some(ts.isIndexSignatureDeclaration)).toBe(false);
      const actual = parameterType.members.map((field) => {
        expect(ts.isPropertySignature(field)).toBe(true);
        if (!ts.isPropertySignature(field) || !field.name || !ts.isIdentifier(field.name)) return "invalid";
        expect(field.questionToken).toBeUndefined();
        return `${field.name.text}:${field.type?.getText(source)}`;
      });
      expect(actual).toEqual(expected);
    }
    const scope = source.statements.find((statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === "SchedulerCapacityScope");
    expect(scope?.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)).toBe(true);
    expect(scope?.type.getText(source).replaceAll(" ", "")).toBe('"organization"|"target"|"global"');
  });
});
