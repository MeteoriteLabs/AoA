import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  closeBoundedDatabaseConnections,
  openDistributedExecutionDatabases,
} from "../db/distributed-execution-databases.js";

function analyzeCsprngAdvisoryBinding(sourceText: string): {
  readonly valid: boolean;
  readonly directRandomBytesImports: number;
  readonly csprngKeyDeclarations: number;
  readonly ownerTemplates: number;
  readonly sharedTemplates: number;
  readonly templatesBoundToKey: number;
} {
  const fileName = "C:/job003-fixture/distributed-execution-databases.ts";
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noResolve: true,
    noLib: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  host.fileExists = (candidate) => candidate === fileName;
  host.readFile = (candidate) => candidate === fileName ? sourceText : undefined;
  host.getSourceFile = (candidate, languageVersion) => candidate === fileName
    ? ts.createSourceFile(candidate, sourceText, languageVersion, true, ts.ScriptKind.TS)
    : undefined;
  const program = ts.createProgram({ rootNames: [fileName], options, host });
  const source = program.getSourceFile(fileName);
  if (!source) {
    return {
      valid: false, directRandomBytesImports: 0, csprngKeyDeclarations: 0,
      ownerTemplates: 0, sharedTemplates: 0, templatesBoundToKey: 0,
    };
  }
  const checker = program.getTypeChecker();
  const directImports = source.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "node:crypto") return [];
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) return [];
    return bindings.elements.filter((element) =>
      element.propertyName === undefined && element.name.text === "randomBytes");
  });
  const importSymbol = directImports.length === 1
    ? checker.getSymbolAtLocation(directImports[0]!.name)
    : undefined;
  const keyDeclarations: ts.VariableDeclaration[] = [];
  const visitKeys = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isPropertyAccessExpression(node.initializer.expression) &&
      node.initializer.expression.name.text === "readBigInt64BE") {
      const randomCall = node.initializer.expression.expression;
      if (ts.isCallExpression(randomCall) && ts.isIdentifier(randomCall.expression) &&
        checker.getSymbolAtLocation(randomCall.expression) === importSymbol &&
        randomCall.arguments.length === 1 && ts.isNumericLiteral(randomCall.arguments[0]!) &&
        randomCall.arguments[0]!.text === "8" && ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.Const) !== 0) {
        keyDeclarations.push(node);
      }
    }
    ts.forEachChild(node, visitKeys);
  };
  visitKeys(source);
  const keySymbol = keyDeclarations.length === 1 && ts.isIdentifier(keyDeclarations[0]!.name)
    ? checker.getSymbolAtLocation(keyDeclarations[0]!.name)
    : undefined;
  let ownerTemplates = 0;
  let sharedTemplates = 0;
  let templatesBoundToKey = 0;
  const visitTemplates = (node: ts.Node) => {
    if (ts.isTaggedTemplateExpression(node) && node.tag.getText(source) === "sql") {
      const sqlText = node.template.getText(source);
      const owner = /pg_advisory_xact_lock\s*\(/u.test(sqlText) && !sqlText.includes("shared");
      const shared = /pg_try_advisory_xact_lock_shared\s*\(/u.test(sqlText);
      if (owner || shared) {
        if (owner) ownerTemplates += 1;
        if (shared) sharedTemplates += 1;
        const expressions = ts.isTemplateExpression(node.template)
          ? node.template.templateSpans.map((span) => span.expression)
          : [];
        if (keySymbol !== undefined && expressions.length === 1 &&
          ts.isIdentifier(expressions[0]!) &&
          checker.getSymbolAtLocation(expressions[0]!) === keySymbol) {
          templatesBoundToKey += 1;
        }
      }
    }
    ts.forEachChild(node, visitTemplates);
  };
  visitTemplates(source);
  const totalTemplates = ownerTemplates + sharedTemplates;
  return {
    valid: directImports.length === 1 && keyDeclarations.length === 1 &&
      ownerTemplates > 0 && sharedTemplates > 0 && templatesBoundToKey === totalTemplates,
    directRandomBytesImports: directImports.length,
    csprngKeyDeclarations: keyDeclarations.length,
    ownerTemplates,
    sharedTemplates,
    templatesBoundToKey,
  };
}

const STARTUP_PHASES = [
  "owner-exclusive",
  "app-negative",
  "operator-negative",
  "app-positive",
  "operator-positive",
] as const;

function analyzeSharedStartupBudget(sourceText: string): {
  readonly valid: boolean;
  readonly controllers: number;
  readonly deadlines: number;
  readonly budgetedPhases: readonly string[];
  readonly negativeConcurrent: boolean;
  readonly positiveConcurrent: boolean;
  readonly budgetedBarrierPhases: readonly string[];
} {
  const fileName = "C:/job003-fixture/distributed-execution-databases.ts";
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noResolve: true,
    noLib: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  host.fileExists = (candidate) => candidate === fileName;
  host.readFile = (candidate) => candidate === fileName ? sourceText : undefined;
  host.getSourceFile = (candidate, languageVersion) => candidate === fileName
    ? ts.createSourceFile(candidate, sourceText, languageVersion, true, ts.ScriptKind.TS)
    : undefined;
  const program = ts.createProgram({ rootNames: [fileName], options, host });
  const source = program.getSourceFile(fileName);
  if (!source) {
    return {
      valid: false, controllers: 0, deadlines: 0, budgetedPhases: [],
      negativeConcurrent: false, positiveConcurrent: false, budgetedBarrierPhases: [],
    };
  }
  const checker = program.getTypeChecker();
  const controllerDeclarations: ts.VariableDeclaration[] = [];
  const deadlineDeclarations: ts.VariableDeclaration[] = [];
  const deadlineWrites: ts.BinaryExpression[] = [];
  let independentSignalTimeouts = 0;
  const containsMonotonicClock = (node: ts.Node): boolean => {
    let found = false;
    const visit = (candidate: ts.Node) => {
      if (ts.isCallExpression(candidate) &&
        candidate.expression.getText(source) === "performance.now") found = true;
      ts.forEachChild(candidate, visit);
    };
    visit(node);
    return found;
  };
  const collectOuterBindings = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (node.initializer && ts.isNewExpression(node.initializer) &&
        node.initializer.expression.getText(source) === "AbortController" &&
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.Const) !== 0) {
        controllerDeclarations.push(node);
      }
      if (node.initializer && ts.isBinaryExpression(node.initializer) &&
        node.initializer.operatorToken.kind === ts.SyntaxKind.PlusToken &&
        containsMonotonicClock(node.initializer) && ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.Const) !== 0) {
        deadlineDeclarations.push(node);
      }
    }
    if (ts.isCallExpression(node) && node.expression.getText(source) === "AbortSignal.timeout") {
      independentSignalTimeouts += 1;
    }
    ts.forEachChild(node, collectOuterBindings);
  };
  collectOuterBindings(source);
  const controllerSymbol = controllerDeclarations.length === 1 &&
    ts.isIdentifier(controllerDeclarations[0]!.name)
    ? checker.getSymbolAtLocation(controllerDeclarations[0]!.name)
    : undefined;
  const deadlineSymbol = deadlineDeclarations.length === 1 &&
    ts.isIdentifier(deadlineDeclarations[0]!.name)
    ? checker.getSymbolAtLocation(deadlineDeclarations[0]!.name)
    : undefined;
  const isExactSignal = (node: ts.Node) => ts.isPropertyAccessExpression(node) &&
    node.name.text === "signal" && ts.isIdentifier(node.expression) &&
    checker.getSymbolAtLocation(node.expression) === controllerSymbol;
  const isExactDeadline = (node: ts.Node) => ts.isIdentifier(node) &&
    checker.getSymbolAtLocation(node) === deadlineSymbol;
  const subtreeBudgetBindings = (node: ts.Node) => {
    let signal = false;
    let deadline = false;
    const visit = (candidate: ts.Node) => {
      if (ts.isFunctionLike(candidate)) return;
      if (isExactSignal(candidate)) signal = true;
      if (isExactDeadline(candidate)) deadline = true;
      ts.forEachChild(candidate, visit);
    };
    visit(node);
    return { signal, deadline };
  };
  const functionSymbol = (node: ts.FunctionLikeDeclaration): ts.Symbol | undefined => {
    if (node.name && ts.isIdentifier(node.name)) return checker.getSymbolAtLocation(node.name);
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
      return checker.getSymbolAtLocation(node.parent.name);
    }
    return undefined;
  };
  const budgetCarrierParameters = new Map<ts.Symbol, ReadonlySet<number>>();
  const collectBudgetCarriers = (node: ts.Node) => {
    if (ts.isFunctionLike(node) && node.body) {
      const symbol = functionSymbol(node);
      const parameterIndexes = new Map<ts.Symbol, number>();
      node.parameters.forEach((parameter, index) => {
        if (!ts.isIdentifier(parameter.name)) return;
        const parameterSymbol = checker.getSymbolAtLocation(parameter.name);
        if (parameterSymbol !== undefined) parameterIndexes.set(parameterSymbol, index);
      });
      const allInvocations = new Map<number, Set<ts.CallExpression>>();
      const boundedInvocations = new Map<number, Set<ts.CallExpression>>();
      const visit = (candidate: ts.Node) => {
        if (ts.isFunctionLike(candidate)) return;
        if (ts.isCallExpression(candidate)) {
          if (ts.isIdentifier(candidate.expression)) {
            const invokedSymbol = checker.getSymbolAtLocation(candidate.expression);
            const parameterIndex = invokedSymbol === undefined
              ? undefined
              : parameterIndexes.get(invokedSymbol);
            if (parameterIndex !== undefined) {
              const invocations = allInvocations.get(parameterIndex) ?? new Set<ts.CallExpression>();
              invocations.add(candidate);
              allInvocations.set(parameterIndex, invocations);
            }
          }
          const bindings = candidate.arguments.reduce(
            (found, argument) => {
              const current = subtreeBudgetBindings(argument);
              return {
                signal: found.signal || current.signal,
                deadline: found.deadline || current.deadline,
              };
            },
            { signal: false, deadline: false },
          );
          const invokedParameters = new Map<number, Set<ts.CallExpression>>();
          for (const argument of candidate.arguments) {
            const findWorkInvocation = (descendant: ts.Node) => {
              if (ts.isFunctionLike(descendant)) return;
              if (ts.isCallExpression(descendant) && ts.isIdentifier(descendant.expression)) {
                const invoked = checker.getSymbolAtLocation(descendant.expression);
                const parameterIndex = invoked === undefined ? undefined : parameterIndexes.get(invoked);
                if (parameterIndex !== undefined) {
                  const invocations = invokedParameters.get(parameterIndex) ?? new Set<ts.CallExpression>();
                  invocations.add(descendant);
                  invokedParameters.set(parameterIndex, invocations);
                }
              }
              ts.forEachChild(descendant, findWorkInvocation);
            };
            findWorkInvocation(argument);
          }
          let parent: ts.Node | undefined = candidate.parent;
          let controlsSettlement = false;
          while (parent && parent !== node) {
            if (ts.isAwaitExpression(parent) || ts.isReturnStatement(parent)) {
              controlsSettlement = true;
              break;
            }
            parent = parent.parent;
          }
          if (bindings.signal && bindings.deadline && controlsSettlement) {
            for (const [parameterIndex, invocations] of invokedParameters) {
              const bounded = boundedInvocations.get(parameterIndex) ?? new Set<ts.CallExpression>();
              for (const invocation of invocations) bounded.add(invocation);
              boundedInvocations.set(parameterIndex, bounded);
            }
          }
        }
        ts.forEachChild(candidate, visit);
      };
      visit(node.body);
      if (symbol) {
        const exclusivelyBounded = new Set<number>();
        for (const [parameterIndex, bounded] of boundedInvocations) {
          const all = allInvocations.get(parameterIndex) ?? new Set<ts.CallExpression>();
          if (bounded.size > 0 && all.size === bounded.size && [...all].every((call) => bounded.has(call))) {
            exclusivelyBounded.add(parameterIndex);
          }
        }
        if (exclusivelyBounded.size > 0) budgetCarrierParameters.set(symbol, exclusivelyBounded);
      }
    }
    ts.forEachChild(node, collectBudgetCarriers);
  };
  collectBudgetCarriers(source);
  const phaseCalls = new Map<string, ts.CallExpression[]>();
  const promiseAllCalls: ts.CallExpression[] = [];
  const callPhaseLabels = (call: ts.CallExpression) => {
    const labels = new Set<string>();
    for (const argument of call.arguments) {
      const visit = (candidate: ts.Node) => {
        if (candidate !== argument &&
          (ts.isCallExpression(candidate) || ts.isFunctionLike(candidate))) return;
        if (ts.isStringLiteral(candidate) &&
          (STARTUP_PHASES as readonly string[]).includes(candidate.text)) labels.add(candidate.text);
        ts.forEachChild(candidate, visit);
      };
      visit(argument);
    }
    return [...labels];
  };
  const collectPhaseCalls = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const labels = callPhaseLabels(node);
      if (labels.length > 0) {
        for (const phase of labels) {
          const calls = phaseCalls.get(phase) ?? [];
          calls.push(node);
          phaseCalls.set(phase, calls);
        }
      }
      if (node.expression.getText(source) === "Promise.all") {
        promiseAllCalls.push(node);
      }
    }
    ts.forEachChild(node, collectPhaseCalls);
  };
  collectPhaseCalls(source);
  const budgetedPhases: string[] = [];
  const budgetedBarrierPhases: string[] = [];
  const budgetedCalls = new Map<string, ts.CallExpression>();
  const functionLikeArgument = (node: ts.Expression): boolean => {
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true;
    if (!ts.isIdentifier(node)) return false;
    const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
    return declaration !== undefined && (
      ts.isFunctionDeclaration(declaration) ||
      (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined &&
        (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)))
    );
  };
  const hasAwaitedBarrier = (node: ts.Node): boolean => {
    let found = false;
    const visit = (candidate: ts.Node) => {
      if (ts.isAwaitExpression(candidate) && /barrier/iu.test(candidate.expression.getText(source))) {
        found = true;
      }
      ts.forEachChild(candidate, visit);
    };
    visit(node);
    return found;
  };
  for (const phase of STARTUP_PHASES) {
    const calls = phaseCalls.get(phase) ?? [];
    const budgeted = calls.length === 1 ? calls[0] : undefined;
    const workArgument = budgeted === undefined ? undefined : (() => {
      const calleeSymbol = checker.getSymbolAtLocation(budgeted.expression);
      const boundedIndexes = calleeSymbol === undefined
        ? undefined
        : budgetCarrierParameters.get(calleeSymbol);
      if (boundedIndexes === undefined) return undefined;
      const callbackIndexes = budgeted.arguments.flatMap((argument, index) =>
        functionLikeArgument(argument) ? [index] : []);
      if (callbackIndexes.length !== 1 || !boundedIndexes.has(callbackIndexes[0]!)) return undefined;
      return budgeted.arguments[callbackIndexes[0]!]!;
    })();
    if (budgeted && workArgument) {
      budgetedPhases.push(phase);
      budgetedCalls.set(phase, budgeted);
      if (hasAwaitedBarrier(workArgument)) budgetedBarrierPhases.push(phase);
    }
  }
  if (deadlineSymbol !== undefined) {
    const findWrites = (node: ts.Node) => {
      if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left) &&
        checker.getSymbolAtLocation(node.left) === deadlineSymbol &&
        ts.isAssignmentOperator(node.operatorToken.kind)) deadlineWrites.push(node);
      ts.forEachChild(node, findWrites);
    };
    findWrites(source);
  }
  const containsNode = (root: ts.Node, target: ts.Node): boolean => {
    if (root === target) return true;
    let found = false;
    ts.forEachChild(root, (child) => {
      if (!found && containsNode(child, target)) found = true;
    });
    return found;
  };
  const includesPair = (left: string, right: string) => {
    const leftCall = budgetedCalls.get(left);
    const rightCall = budgetedCalls.get(right);
    return leftCall !== undefined && rightCall !== undefined && promiseAllCalls.some((promiseAll) =>
      containsNode(promiseAll, leftCall) && containsNode(promiseAll, rightCall));
  };
  const negativeConcurrent = includesPair("app-negative", "operator-negative");
  const positiveConcurrent = includesPair("app-positive", "operator-positive");
  const requiredBarriers = ["owner-exclusive", "app-positive", "operator-positive"];
  return {
    valid: controllerDeclarations.length === 1 && deadlineDeclarations.length === 1 &&
      deadlineWrites.length === 0 && independentSignalTimeouts === 0 &&
      budgetedPhases.length === STARTUP_PHASES.length && negativeConcurrent && positiveConcurrent &&
      requiredBarriers.every((phase) => budgetedBarrierPhases.includes(phase)),
    controllers: controllerDeclarations.length,
    deadlines: deadlineDeclarations.length,
    budgetedPhases,
    negativeConcurrent,
    positiveConcurrent,
    budgetedBarrierPhases,
  };
}

describe("distributed-execution database strangler", () => {
  it("allocates no serving/operator connection and needs no URL while flag-off", async () => {
    await expect(
      openDistributedExecutionDatabases({
        enabled: false,
        appDatabaseUrl: undefined,
        operatorDatabaseUrl: undefined,
      }),
    ).resolves.toBeNull();
  });

  it("attempts both pool closes and reports aggregate failure to the awaited shutdown path", async () => {
    const appFailure = new Error("app close failed");
    const appClose = vi.fn(async () => { throw appFailure; });
    const operatorClose = vi.fn(async () => {});

    await expect(
      closeBoundedDatabaseConnections([
        { close: operatorClose },
        { close: appClose },
      ]),
    ).rejects.toMatchObject({
      message: "Failed to close bounded distributed database pools",
      errors: [appFailure],
    });
    expect(operatorClose).toHaveBeenCalledOnce();
    expect(appClose).toHaveBeenCalledOnce();
    expect(operatorClose).toHaveBeenCalledWith({ timeoutSeconds: 5 });
    expect(appClose).toHaveBeenCalledWith({ timeoutSeconds: 5 });
  });

  it("pins one bounded startup deadline and the exact max-four/timeout connection contract", () => {
    // Mutation caught: widening either pool, reusing a stale statement timeout, or racing an
    // abandoned naked close defeats the startup/cleanup bound even if happy-path auth passes.
    const source = readFileSync(new URL("../db/distributed-execution-databases.ts", import.meta.url), "utf8");
    const client = readFileSync(
      new URL("../../../packages/db/src/client.ts", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/pool|max[\s\S]{0,160}\b4\b/i);
    expect(source).toMatch(/statement_timeout[\s\S]{0,160}5_?000/i);
    expect(source).toMatch(/lock_timeout[\s\S]{0,160}750/i);
    expect(source).toMatch(/idle_in_transaction_session_timeout[\s\S]{0,160}5_?000/i);
    expect(source).toMatch(/AbortController/);
    expect(source).toMatch(/Promise\.allSettled/);
    expect(client).toMatch(/connect_timeout[\s\S]{0,160}5_?000/i);
    expect(client).toMatch(/idle_timeout[\s\S]{0,160}30_?000/i);
    expect(client).toMatch(/end\(\{\s*timeout:\s*5\s*\}\)/);
    expect(source).not.toMatch(/Promise\.race\([\s\S]{0,120}\.close\(/);
  });

  it("owns exactly one immutable deadline and one shared abort controller for the complete handshake", () => {
    const strictValidFixture = `
      const startupAbort = new AbortController();
      const startupDeadline = performance.now() + 5_000;
      const settleWithBudget = async (work: Promise<unknown>, signal: AbortSignal, deadline: number) =>
        await Promise.resolve([work, signal, deadline]);
      const runPhase = async (_phase: string, work: () => Promise<unknown>) =>
        await settleWithBudget(work(), startupAbort.signal, startupDeadline);
      async function handshake() {
        await runPhase("owner-exclusive", async () => { await ownerBarrier.wait(); });
        await Promise.all([
          runPhase("app-negative", async () => await appProbe()),
          runPhase("operator-negative", async () => await operatorProbe()),
        ]);
        await Promise.all([
          runPhase("app-positive", async () => { await appBarrier.wait(); }),
          runPhase("operator-positive", async () => { await operatorBarrier.wait(); }),
        ]);
      }
      void handshake;
    `;
    expect(analyzeSharedStartupBudget(strictValidFixture)).toEqual({
      valid: true,
      controllers: 1,
      deadlines: 1,
      budgetedPhases: [...STARTUP_PHASES],
      negativeConcurrent: true,
      positiveConcurrent: true,
      budgetedBarrierPhases: ["owner-exclusive", "app-positive", "operator-positive"],
    });

    const dummyOuterBudget = `
      const startupAbort = new AbortController();
      const startupDeadline = performance.now() + 5_000;
      const observeBudget = async (signal: AbortSignal, deadline: number) =>
        await Promise.resolve([signal, deadline]);
      const runPhase = async (_phase: string, work: () => Promise<unknown>) => {
        await observeBudget(startupAbort.signal, startupDeadline);
        return await Promise.race([
          work(),
          new Promise((resolve) => setTimeout(resolve, 5_000)),
        ]);
      };
      async function handshake() {
        await runPhase("owner-exclusive", async () => { await ownerBarrier.wait(); });
        await Promise.all([
          runPhase("app-negative", async () => await appProbe()),
          runPhase("operator-negative", async () => await operatorProbe()),
        ]);
        await Promise.all([
          runPhase("app-positive", async () => { await appBarrier.wait(); }),
          runPhase("operator-positive", async () => { await operatorBarrier.wait(); }),
        ]);
      }
      void handshake;
    `;
    expect(analyzeSharedStartupBudget(dummyOuterBudget).valid).toBe(false);

    const boundedDecoyWork = `
      const startupAbort = new AbortController();
      const startupDeadline = performance.now() + 5_000;
      const settleWithBudget = async (work: Promise<unknown>, signal: AbortSignal, deadline: number) =>
        await Promise.resolve([work, signal, deadline]);
      const runPhase = async (
        _phase: string,
        work: () => Promise<unknown>,
        decoy: () => Promise<unknown> = async () => undefined,
      ) => {
        await settleWithBudget(decoy(), startupAbort.signal, startupDeadline);
        return await work();
      };
      async function handshake() {
        await runPhase("owner-exclusive", async () => { await ownerBarrier.wait(); });
        await Promise.all([
          runPhase("app-negative", async () => await appProbe()),
          runPhase("operator-negative", async () => await operatorProbe()),
        ]);
        await Promise.all([
          runPhase("app-positive", async () => { await appBarrier.wait(); }),
          runPhase("operator-positive", async () => { await operatorBarrier.wait(); }),
        ]);
      }
      void handshake;
    `;
    expect(analyzeSharedStartupBudget(boundedDecoyWork).valid).toBe(false);

    const duplicatePhaseSite = strictValidFixture.replace(
      'await runPhase("owner-exclusive", async () => { await ownerBarrier.wait(); });',
      `await runPhase("owner-exclusive", async () => { await ownerBarrier.wait(); });
       if (false) await runPhase("owner-exclusive", async () => { await ownerBarrier.wait(); });`,
    );
    expect(analyzeSharedStartupBudget(duplicatePhaseSite).valid).toBe(false);

    const independentlyResetPhaseBudget = `
      const startupAbort = new AbortController();
      const startupDeadline = performance.now() + 5_000;
      const settleWithBudget = async (work: Promise<unknown>, signal: AbortSignal, deadline: number) =>
        await Promise.resolve([work, signal, deadline]);
      const runPhase = async (_phase: string, work: () => Promise<unknown>) => {
        const phaseAbort = new AbortController();
        const phaseDeadline = performance.now() + 5_000;
        void startupAbort.signal;
        void startupDeadline;
        return await settleWithBudget(work(), phaseAbort.signal, phaseDeadline);
      };
      async function handshake() {
        await runPhase("owner-exclusive", async () => { await ownerBarrier.wait(); });
        await Promise.all([
          runPhase("app-negative", async () => await appProbe()),
          runPhase("operator-negative", async () => await operatorProbe()),
        ]);
        await Promise.all([
          runPhase("app-positive", async () => { await appBarrier.wait(); }),
          runPhase("operator-positive", async () => { await operatorBarrier.wait(); }),
        ]);
      }
      void handshake;
    `;
    expect(analyzeSharedStartupBudget(independentlyResetPhaseBudget).valid).toBe(false);

    const sourceText = readFileSync(
      new URL("../db/distributed-execution-databases.ts", import.meta.url),
      "utf8",
    );
    expect(analyzeSharedStartupBudget(sourceText)).toEqual({
      valid: true,
      controllers: 1,
      deadlines: 1,
      budgetedPhases: [...STARTUP_PHASES],
      negativeConcurrent: true,
      positiveConcurrent: true,
      budgetedBarrierPhases: ["owner-exclusive", "app-positive", "operator-positive"],
    });
  });

  it("binds the advisory domain to the exact CSPRNG signed-bigint expression", () => {
    // Mutation caught: a timestamp/counter/Math.random key can be unique in two test runs while
    // remaining predictable. The owner-exclusive and shared probes must consume this one binding.
    const strictValidFixture = `
      import { randomBytes } from "node:crypto";
      import { sql } from "drizzle-orm";
      const advisoryKey = randomBytes(8).readBigInt64BE();
      const owner = sql\`SELECT pg_advisory_xact_lock(\${advisoryKey})\`;
      const shared = sql\`SELECT pg_try_advisory_xact_lock_shared(\${advisoryKey})\`;
      void owner; void shared;
    `;
    expect(analyzeCsprngAdvisoryBinding(strictValidFixture)).toMatchObject({
      valid: true,
      directRandomBytesImports: 1,
      csprngKeyDeclarations: 1,
      ownerTemplates: 1,
      sharedTemplates: 1,
      templatesBoundToKey: 2,
    });

    const locallyShadowedRandomBytes = `
      import { randomBytes } from "node:crypto";
      import { sql } from "drizzle-orm";
      function handshake() {
        const randomBytes = (_size: number) => ({ readBigInt64BE: () => 7n });
        const advisoryKey = randomBytes(8).readBigInt64BE();
        const owner = sql\`SELECT pg_advisory_xact_lock(\${advisoryKey})\`;
        const shared = sql\`SELECT pg_try_advisory_xact_lock_shared(\${advisoryKey})\`;
        return [owner, shared];
      }
      void handshake;
    `;
    expect(analyzeCsprngAdvisoryBinding(locallyShadowedRandomBytes).valid).toBe(false);

    const aliasedRandomBytes = `
      import { randomBytes as entropy } from "node:crypto";
      import { sql } from "drizzle-orm";
      const advisoryKey = entropy(8).readBigInt64BE();
      const owner = sql\`SELECT pg_advisory_xact_lock(\${advisoryKey})\`;
      const shared = sql\`SELECT pg_try_advisory_xact_lock_shared(\${advisoryKey})\`;
      void owner; void shared;
    `;
    expect(analyzeCsprngAdvisoryBinding(aliasedRandomBytes).valid).toBe(false);

    const unusedRandomKeyWithShadowedAdvisoryKey = `
      import { randomBytes } from "node:crypto";
      import { sql } from "drizzle-orm";
      const advisoryKey = randomBytes(8).readBigInt64BE();
      function handshake() {
        const advisoryKey = 42n;
        const owner = sql\`SELECT pg_advisory_xact_lock(\${advisoryKey})\`;
        const shared = sql\`SELECT pg_try_advisory_xact_lock_shared(\${advisoryKey})\`;
        return [owner, shared];
      }
      void advisoryKey; void handshake;
    `;
    expect(analyzeCsprngAdvisoryBinding(unusedRandomKeyWithShadowedAdvisoryKey).valid).toBe(false);

    const secondKeyLaundering = `
      import { randomBytes } from "node:crypto";
      import { sql } from "drizzle-orm";
      const advisoryKey = randomBytes(8).readBigInt64BE();
      const queryKey = advisoryKey;
      const owner = sql\`SELECT pg_advisory_xact_lock(\${queryKey})\`;
      const shared = sql\`SELECT pg_try_advisory_xact_lock_shared(\${queryKey})\`;
      void owner; void shared;
    `;
    expect(analyzeCsprngAdvisoryBinding(secondKeyLaundering).valid).toBe(false);

    const sourceText = readFileSync(
      new URL("../db/distributed-execution-databases.ts", import.meta.url),
      "utf8",
    );
    expect(analyzeCsprngAdvisoryBinding(sourceText)).toMatchObject({
      valid: true,
      directRandomBytesImports: 1,
      csprngKeyDeclarations: 1,
      ownerTemplates: expect.any(Number),
      sharedTemplates: expect.any(Number),
    });
  });

  it("exports only the closed non-secret startup error vocabulary", () => {
    const source = readFileSync(new URL("../db/distributed-execution-databases.ts", import.meta.url), "utf8");
    for (const code of [
      "distributed_execution_configuration",
      "distributed_execution_migration_identity",
      "distributed_execution_app_authority",
      "distributed_execution_operator_authority",
      "distributed_execution_advisory_domain",
      "distributed_execution_timeout",
      "distributed_execution_close",
    ]) {
      expect(source).toContain(code);
    }
  });
});
