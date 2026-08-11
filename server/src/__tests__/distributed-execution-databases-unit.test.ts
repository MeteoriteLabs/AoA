import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  closeBoundedDatabaseConnections,
  openDistributedExecutionDatabases,
} from "../db/distributed-execution-databases.js";

function findExportedOpenFunction(source: ts.SourceFile): ts.FunctionDeclaration | undefined {
  const matches = source.statements.filter((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) &&
    statement.name?.text === "openDistributedExecutionDatabases" &&
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function nearestFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isFunctionLike(current)) return current;
    current = current.parent;
  }
  return undefined;
}

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
  const openFunction = findExportedOpenFunction(source);
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
  const perOpenKeyDeclarations = keyDeclarations.filter((declaration) =>
    nearestFunction(declaration) === openFunction,
  );
  const keySymbol = perOpenKeyDeclarations.length === 1 &&
    ts.isIdentifier(perOpenKeyDeclarations[0]!.name)
    ? checker.getSymbolAtLocation(perOpenKeyDeclarations[0]!.name)
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
  if (openFunction) visitTemplates(openFunction);
  const totalTemplates = ownerTemplates + sharedTemplates;
  return {
    valid: openFunction !== undefined && directImports.length === 1 && keyDeclarations.length === 1 &&
      perOpenKeyDeclarations.length === 1 &&
      ownerTemplates > 0 && sharedTemplates > 0 && templatesBoundToKey === totalTemplates,
    directRandomBytesImports: directImports.length,
    csprngKeyDeclarations: keyDeclarations.length,
    ownerTemplates,
    sharedTemplates,
    templatesBoundToKey,
  };
}

const STARTUP_PHASES = [
  "migration-identity",
  "app-authority",
  "operator-authority",
  "owner-exclusive",
  "app-negative",
  "operator-negative",
  "app-positive",
  "operator-positive",
] as const;

const HERMETIC_MIGRATION_HASH = "a".repeat(64);
const HERMETIC_MIGRATION_IDENTITY = Object.freeze({
  orderedHashes: Object.freeze([HERMETIC_MIGRATION_HASH]),
  ledgerSha256: createHash("sha256")
    .update(JSON.stringify([HERMETIC_MIGRATION_HASH]))
    .digest("hex"),
});

function createHermeticOwnerDb(options: Record<string, unknown>) {
  const dialect = new PgDialect();
  const ownerIdentity = {
    pid: 101,
    backend_start: "2026-08-12 00:00:00+00",
    role_name: "owner",
    session_role: "owner",
    session_user: "owner",
    usename: "owner",
    database_name: "aoa_control",
    datname: "aoa_control",
    application_name: "job003-hermetic-owner",
    session_tag: "job003-hermetic-owner",
  };
  const execute = async (statement: unknown) => {
    const text = dialect.sqlToQuery(statement as never).sql.toLowerCase();
    if (text.includes("__drizzle_migrations")) {
      return [{ id: 1, hash: HERMETIC_MIGRATION_HASH }];
    }
    if (text.includes("participant_pids_gone")) {
      return [{
        participant_pids_gone: true,
        owner_out_of_transaction: true,
        advisory_locks_gone: true,
      }];
    }
    if (text.includes("pg_backend_pid") || text.includes("backend_start")) {
      return [ownerIdentity];
    }
    return [];
  };
  const ownerDb = {
    execute,
    $client: { options },
    transaction: async (callback: (transaction: unknown) => unknown) => {
      return callback({ execute });
    },
  };
  return { ownerDb };
}

function analyzeSharedStartupBudget(sourceText: string): {
  readonly valid: boolean;
  readonly openFunctions: number;
  readonly controllers: number;
  readonly deadlines: number;
  readonly budgetMs: number | null;
  readonly budgetedPhases: readonly string[];
  readonly causallyBoundPhases: readonly string[];
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
      valid: false, openFunctions: 0, controllers: 0, deadlines: 0, budgetMs: null,
      budgetedPhases: [], causallyBoundPhases: [],
      negativeConcurrent: false, positiveConcurrent: false, budgetedBarrierPhases: [],
    };
  }
  const checker = program.getTypeChecker();
  const openFunctions = source.statements.filter((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) &&
    statement.name?.text === "openDistributedExecutionDatabases" &&
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true,
  );
  const openFunction = openFunctions.length === 1 ? openFunctions[0] : undefined;
  const cleanupFunctions = source.statements.filter((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) &&
    statement.name?.text === "assertTrackedParticipantsClosed",
  );
  const cleanupFunction = cleanupFunctions.length === 1 ? cleanupFunctions[0] : undefined;
  const controllerDeclarations: ts.VariableDeclaration[] = [];
  const controllerConstructions: ts.NewExpression[] = [];
  const deadlineDeclarations: ts.VariableDeclaration[] = [];
  const deadlineBudgets = new Map<ts.VariableDeclaration, number | null>();
  const deadlineWrites: ts.BinaryExpression[] = [];
  let independentSignalTimeouts = 0;
  const timeoutCalls: ts.CallExpression[] = [];
  const unwrap = (node: ts.Expression): ts.Expression => {
    let current = node;
    while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current)) current = current.expression;
    return current;
  };
  const isUnshadowedGlobalIdentifier = (node: ts.Node, name: string): node is ts.Identifier =>
    ts.isIdentifier(node) && node.text === name &&
    checker.getSymbolAtLocation(node)?.valueDeclaration === undefined;
  const resolvesGlobalMember = (
    node: ts.Expression,
    member: "AbortController" | "setTimeout",
    remainingAliasHops = 1,
  ): boolean => {
    const expression = unwrap(node);
    if (ts.isPropertyAccessExpression(expression)) {
      const receiver = unwrap(expression.expression);
      return expression.name.text === member && ts.isIdentifier(receiver) &&
        receiver.text === "globalThis" &&
        checker.getSymbolAtLocation(receiver)?.valueDeclaration === undefined;
    }
    if (!ts.isIdentifier(expression)) return false;
    const symbol = checker.getSymbolAtLocation(expression);
    if (expression.text === member && symbol?.valueDeclaration === undefined) return true;
    if (remainingAliasHops === 0) return false;
    const declaration = symbol?.valueDeclaration;
    return declaration !== undefined && ts.isVariableDeclaration(declaration) &&
      ts.isVariableDeclarationList(declaration.parent) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
      declaration.initializer !== undefined &&
      resolvesGlobalMember(declaration.initializer, member, remainingAliasHops - 1);
  };
  const resolvesAbortSignalTimeout = (
    node: ts.Expression,
    remainingAliasHops = 1,
  ): boolean => {
    const expression = unwrap(node);
    if (ts.isPropertyAccessExpression(expression) && expression.name.text === "timeout") {
      const receiver = unwrap(expression.expression);
      if (ts.isIdentifier(receiver)) {
        return receiver.text === "AbortSignal" &&
          checker.getSymbolAtLocation(receiver)?.valueDeclaration === undefined;
      }
      return ts.isPropertyAccessExpression(receiver) && receiver.name.text === "AbortSignal" &&
        ts.isIdentifier(unwrap(receiver.expression)) &&
        unwrap(receiver.expression).getText(source) === "globalThis" &&
        checker.getSymbolAtLocation(unwrap(receiver.expression))?.valueDeclaration === undefined;
    }
    if (!ts.isIdentifier(expression) || remainingAliasHops === 0) return false;
    const declaration = checker.getSymbolAtLocation(expression)?.valueDeclaration;
    return declaration !== undefined && ts.isVariableDeclaration(declaration) &&
      ts.isVariableDeclarationList(declaration.parent) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
      declaration.initializer !== undefined &&
      resolvesAbortSignalTimeout(declaration.initializer, remainingAliasHops - 1);
  };
  const isPerformanceNow = (node: ts.Node): boolean => {
    const expression = ts.isExpression(node) ? unwrap(node) : node;
    if (!ts.isCallExpression(expression) || expression.arguments.length !== 0) return false;
    const callee = unwrap(expression.expression);
    return ts.isPropertyAccessExpression(callee) && callee.name.text === "now" &&
      isUnshadowedGlobalIdentifier(unwrap(callee.expression), "performance");
  };
  const numericConstValue = (node: ts.Expression): number | null => {
    const expression = unwrap(node);
    if (ts.isNumericLiteral(expression)) return Number(expression.text.replaceAll("_", ""));
    if (!ts.isIdentifier(expression)) return null;
    const declaration = checker.getSymbolAtLocation(expression)?.valueDeclaration;
    if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer ||
      !ts.isVariableDeclarationList(declaration.parent) ||
      (declaration.parent.flags & ts.NodeFlags.Const) === 0) return null;
    const initializer = unwrap(declaration.initializer);
    return ts.isNumericLiteral(initializer)
      ? Number(initializer.text.replaceAll("_", ""))
      : null;
  };
  const deadlineBudget = (node: ts.Expression): number | null => {
    const expression = unwrap(node);
    if (!ts.isBinaryExpression(expression) ||
      expression.operatorToken.kind !== ts.SyntaxKind.PlusToken) return null;
    if (isPerformanceNow(expression.left)) return numericConstValue(expression.right);
    if (isPerformanceNow(expression.right)) return numericConstValue(expression.left);
    return null;
  };
  const isDeadlineShape = (node: ts.Expression): boolean => {
    const expression = unwrap(node);
    return ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      (isPerformanceNow(expression.left) || isPerformanceNow(expression.right));
  };
  const collectBindings = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (node.initializer && ts.isNewExpression(node.initializer) &&
        resolvesGlobalMember(node.initializer.expression, "AbortController") &&
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.Const) !== 0) {
        controllerDeclarations.push(node);
      }
      if (node.initializer && isDeadlineShape(node.initializer) &&
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.Const) !== 0) {
        deadlineDeclarations.push(node);
        deadlineBudgets.set(node, deadlineBudget(node.initializer));
      }
    }
    if (ts.isNewExpression(node) &&
      resolvesGlobalMember(node.expression, "AbortController")) {
      controllerConstructions.push(node);
    }
    if (ts.isCallExpression(node) && resolvesAbortSignalTimeout(node.expression)) {
      independentSignalTimeouts += 1;
    }
    if (ts.isCallExpression(node) && resolvesGlobalMember(node.expression, "setTimeout")) {
      timeoutCalls.push(node);
    }
    ts.forEachChild(node, collectBindings);
  };
  collectBindings(source);
  const perOpenControllers = controllerDeclarations.filter((declaration) =>
    nearestFunction(declaration) === openFunction,
  );
  const perOpenDeadlines = deadlineDeclarations.filter((declaration) =>
    nearestFunction(declaration) === openFunction,
  );
  const controllerSymbol = perOpenControllers.length === 1 &&
    ts.isIdentifier(perOpenControllers[0]!.name)
    ? checker.getSymbolAtLocation(perOpenControllers[0]!.name)
    : undefined;
  const controllerSymbols = new Set<ts.Symbol>();
  if (controllerSymbol) controllerSymbols.add(controllerSymbol);
  const collectControllerInstanceAliases = (node: ts.Node) => {
    if (controllerSymbol && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
      node.initializer && ts.isIdentifier(unwrap(node.initializer)) &&
      checker.getSymbolAtLocation(unwrap(node.initializer)) === controllerSymbol &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0) {
      const aliasSymbol = checker.getSymbolAtLocation(node.name);
      if (aliasSymbol) controllerSymbols.add(aliasSymbol);
    }
    ts.forEachChild(node, collectControllerInstanceAliases);
  };
  collectControllerInstanceAliases(source);
  const deadlineSymbol = perOpenDeadlines.length === 1 &&
    ts.isIdentifier(perOpenDeadlines[0]!.name)
    ? checker.getSymbolAtLocation(perOpenDeadlines[0]!.name)
    : undefined;
  const budgetMs = perOpenDeadlines.length === 1
    ? deadlineBudgets.get(perOpenDeadlines[0]!) ?? null
    : null;
  const isExactSignal = (node: ts.Node) => ts.isPropertyAccessExpression(node) &&
    node.name.text === "signal" && ts.isIdentifier(node.expression) &&
    controllerSymbols.has(checker.getSymbolAtLocation(node.expression)!);
  const isExactDeadline = (node: ts.Node) => ts.isIdentifier(node) &&
    checker.getSymbolAtLocation(node) === deadlineSymbol;
  const functionSymbol = (node: ts.FunctionLikeDeclaration): ts.Symbol | undefined => {
    if (node.name && ts.isIdentifier(node.name)) return checker.getSymbolAtLocation(node.name);
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
      return checker.getSymbolAtLocation(node.parent.name);
    }
    return undefined;
  };
  const containsControllerAbort = (node: ts.Node): boolean => {
    let found = false;
    const visit = (candidate: ts.Node) => {
      if (ts.isCallExpression(candidate) &&
        ts.isPropertyAccessExpression(candidate.expression) &&
        candidate.expression.name.text === "abort" &&
        ts.isIdentifier(candidate.expression.expression) &&
        controllerSymbols.has(checker.getSymbolAtLocation(candidate.expression.expression)!)) {
        found = true;
      }
      ts.forEachChild(candidate, visit);
    };
    visit(node);
    return found;
  };
  const isDirectRejectCall = (node: ts.Node, rejectSymbol: ts.Symbol): boolean => {
    const expression = ts.isExpression(node) ? unwrap(node) : undefined;
    return expression !== undefined && ts.isCallExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      checker.getSymbolAtLocation(expression.expression) === rejectSymbol;
  };
  type ListenerExit = "fallthrough" | "settled" | "unsettled";
  const listenerStatementExits = (
    statement: ts.Statement,
    rejectSymbol: ts.Symbol,
  ): ReadonlySet<ListenerExit> => {
    if (ts.isExpressionStatement(statement)) {
      return new Set<ListenerExit>([
        isDirectRejectCall(statement.expression, rejectSymbol) ? "settled" : "fallthrough",
      ]);
    }
    if (ts.isReturnStatement(statement)) {
      return new Set<ListenerExit>([
        statement.expression && isDirectRejectCall(statement.expression, rejectSymbol)
          ? "settled"
          : "unsettled",
      ]);
    }
    if (ts.isThrowStatement(statement)) return new Set<ListenerExit>(["unsettled"]);
    if (ts.isBlock(statement)) return listenerBlockExits(statement, rejectSymbol);
    if (ts.isIfStatement(statement)) {
      return new Set<ListenerExit>([
        ...listenerStatementExits(statement.thenStatement, rejectSymbol),
        ...(statement.elseStatement
          ? listenerStatementExits(statement.elseStatement, rejectSymbol)
          : ["fallthrough" as const]),
      ]);
    }
    if (ts.isEmptyStatement(statement) || ts.isVariableStatement(statement) ||
      ts.isFunctionDeclaration(statement)) return new Set<ListenerExit>(["fallthrough"]);
    // Loops, switch/try constructs, labels, and other control flow are rejected conservatively:
    // this security oracle accepts only a statically complete synchronous settlement path.
    return new Set<ListenerExit>(["unsettled"]);
  };
  function listenerBlockExits(
    block: ts.Block,
    rejectSymbol: ts.Symbol,
  ): ReadonlySet<ListenerExit> {
    let exits = new Set<ListenerExit>(["fallthrough"]);
    for (const statement of block.statements) {
      const next = new Set<ListenerExit>();
      for (const exit of exits) {
        if (exit === "fallthrough") {
          for (const statementExit of listenerStatementExits(statement, rejectSymbol)) {
            next.add(statementExit);
          }
        } else {
          next.add(exit);
        }
      }
      exits = next;
    }
    return exits;
  }
  const listenerUnconditionallyRejects = (node: ts.Node, rejectSymbol: ts.Symbol): boolean => {
    const expression = ts.isExpression(node) ? unwrap(node) : undefined;
    if (expression && ts.isIdentifier(expression) &&
      checker.getSymbolAtLocation(expression) === rejectSymbol) return true;
    let listener: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | undefined;
    if (expression && (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression))) {
      listener = expression;
    } else if (expression && ts.isIdentifier(expression)) {
      const declaration = checker.getSymbolAtLocation(expression)?.valueDeclaration;
      if (declaration && ts.isFunctionDeclaration(declaration) && declaration.body) listener = declaration;
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer &&
        (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
        listener = declaration.initializer;
      }
    }
    if (!listener?.body) return false;
    if ("asteriskToken" in listener && listener.asteriskToken) return false;
    if (!ts.isBlock(listener.body)) return isDirectRejectCall(listener.body, rejectSymbol);
    const exits = listenerBlockExits(listener.body, rejectSymbol);
    return exits.size === 1 && exits.has("settled");
  };
  const containsRejectingAbortListener = (
    executor: ts.ArrowFunction | ts.FunctionExpression,
    rejectSymbol: ts.Symbol,
  ): boolean => {
    if (!ts.isBlock(executor.body)) return false;
    return executor.body.statements.some((statement) => {
      if (!ts.isExpressionStatement(statement)) return false;
      const candidate = unwrap(statement.expression);
      return ts.isCallExpression(candidate) &&
        ts.isPropertyAccessExpression(candidate.expression) &&
        candidate.expression.name.text === "addEventListener" &&
        isExactSignal(candidate.expression.expression) &&
        ts.isStringLiteral(candidate.arguments[0]) && candidate.arguments[0].text === "abort" &&
        candidate.arguments[1] !== undefined &&
        listenerUnconditionallyRejects(candidate.arguments[1], rejectSymbol);
    });
  };
  const containsDeadlineSubtraction = (node: ts.Node): boolean => {
    let found = false;
    const visit = (candidate: ts.Node) => {
      if (ts.isBinaryExpression(candidate) &&
        candidate.operatorToken.kind === ts.SyntaxKind.MinusToken &&
        isExactDeadline(unwrap(candidate.left)) && isPerformanceNow(candidate.right)) {
        found = true;
      }
      ts.forEachChild(candidate, visit);
    };
    visit(node);
    return found;
  };
  const isCausalCancellationPromise = (node: ts.Expression): boolean => {
    const initializer = unwrap(node);
    if (!ts.isNewExpression(initializer) || initializer.expression.getText(source) !== "Promise") {
      return false;
    }
    const executor = initializer.arguments?.[0];
    if (!executor || (!ts.isArrowFunction(executor) && !ts.isFunctionExpression(executor))) {
      return false;
    }
    const rejectParameter = executor.parameters[1];
    if (!rejectParameter || !ts.isIdentifier(rejectParameter.name)) return false;
    const rejectSymbol = checker.getSymbolAtLocation(rejectParameter.name);
    return rejectSymbol !== undefined && containsRejectingAbortListener(executor, rejectSymbol);
  };
  const causalCarrierParameters = new Map<ts.Symbol, ReadonlySet<number>>();
  const collectCausalCarriers = (node: ts.Node) => {
    if (ts.isFunctionLike(node) && node.body && openFunction &&
      (node === openFunction || (() => {
        let parent: ts.Node | undefined = node.parent;
        while (parent && parent !== openFunction) parent = parent.parent;
        return parent === openFunction;
      })())) {
      const symbol = functionSymbol(node);
      const parameterIndexes = new Map<ts.Symbol, number>();
      node.parameters.forEach((parameter, index) => {
        if (!ts.isIdentifier(parameter.name)) return;
        const parameterSymbol = checker.getSymbolAtLocation(parameter.name);
        if (parameterSymbol) parameterIndexes.set(parameterSymbol, index);
      });
      const cancellationSymbols = new Set<ts.Symbol>();
      const findCancellationPromises = (candidate: ts.Node) => {
        if (ts.isVariableDeclaration(candidate) && nearestFunction(candidate) === node &&
          ts.isIdentifier(candidate.name) && candidate.initializer &&
          isCausalCancellationPromise(candidate.initializer)) {
          const cancellationSymbol = checker.getSymbolAtLocation(candidate.name);
          if (cancellationSymbol) cancellationSymbols.add(cancellationSymbol);
        }
        ts.forEachChild(candidate, findCancellationPromises);
      };
      findCancellationPromises(node.body);

      const allInvocations = new Map<number, Set<ts.CallExpression>>();
      const causalInvocations = new Map<number, Set<ts.CallExpression>>();
      const collectInvocationsAndRaces = (candidate: ts.Node) => {
        if (ts.isCallExpression(candidate) && nearestFunction(candidate) === node &&
          ts.isIdentifier(candidate.expression)) {
          const parameterIndex = parameterIndexes.get(checker.getSymbolAtLocation(candidate.expression)!);
          if (parameterIndex !== undefined) {
            const calls = allInvocations.get(parameterIndex) ?? new Set<ts.CallExpression>();
            calls.add(candidate);
            allInvocations.set(parameterIndex, calls);
          }
        }
        if (ts.isCallExpression(candidate) && nearestFunction(candidate) === node &&
          candidate.expression.getText(source) === "Promise.race" &&
          ts.isArrayLiteralExpression(candidate.arguments[0])) {
          let controlsSettlement = false;
          let parent: ts.Node | undefined = candidate.parent;
          while (parent && parent !== node) {
            if (ts.isAwaitExpression(parent) || ts.isReturnStatement(parent)) {
              controlsSettlement = true;
              break;
            }
            parent = parent.parent;
          }
          const raceArray = candidate.arguments[0];
          const hasCancellation = raceArray.elements.some((element) =>
            ts.isIdentifier(unwrap(element)) &&
            cancellationSymbols.has(checker.getSymbolAtLocation(unwrap(element))!),
          );
          if (controlsSettlement && hasCancellation) {
            const findRacedWork = (descendant: ts.Node) => {
              if (ts.isCallExpression(descendant) && ts.isIdentifier(descendant.expression)) {
                const parameterIndex = parameterIndexes.get(checker.getSymbolAtLocation(descendant.expression)!);
                if (parameterIndex !== undefined) {
                  const calls = causalInvocations.get(parameterIndex) ?? new Set<ts.CallExpression>();
                  calls.add(descendant);
                  causalInvocations.set(parameterIndex, calls);
                }
              }
              ts.forEachChild(descendant, findRacedWork);
            };
            findRacedWork(raceArray);
          }
        }
        ts.forEachChild(candidate, collectInvocationsAndRaces);
      };
      collectInvocationsAndRaces(node.body);
      if (symbol) {
        const exactWorkParameters = new Set<number>();
        for (const [parameterIndex, calls] of allInvocations) {
          const raced = causalInvocations.get(parameterIndex) ?? new Set<ts.CallExpression>();
          if (calls.size > 0 && calls.size === raced.size && [...calls].every((call) => raced.has(call))) {
            exactWorkParameters.add(parameterIndex);
          }
        }
        if (exactWorkParameters.size > 0) causalCarrierParameters.set(symbol, exactWorkParameters);
      }
    }
    ts.forEachChild(node, collectCausalCarriers);
  };
  if (openFunction) collectCausalCarriers(openFunction);
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
  if (openFunction) collectPhaseCalls(openFunction);
  const budgetedPhases: string[] = [];
  const causallyBoundPhases: string[] = [];
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
        : causalCarrierParameters.get(calleeSymbol);
      if (boundedIndexes === undefined) return undefined;
      const callbackIndexes = budgeted.arguments.flatMap((argument, index) =>
        functionLikeArgument(argument) ? [index] : []);
      if (callbackIndexes.length !== 1 || !boundedIndexes.has(callbackIndexes[0]!)) return undefined;
      return budgeted.arguments[callbackIndexes[0]!]!;
    })();
    if (budgeted && workArgument) {
      budgetedPhases.push(phase);
      causallyBoundPhases.push(phase);
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
    if (openFunction) findWrites(openFunction);
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
  const isWithinFunction = (
    node: ts.Node,
    expected: ts.FunctionLikeDeclaration | undefined,
  ): boolean => {
    let current: ts.Node | undefined = node;
    while (current && current !== expected) current = current.parent;
    return expected !== undefined && current === expected;
  };
  const startupTimers = timeoutCalls.filter((call) => isWithinFunction(call, openFunction));
  const cleanupTimers = timeoutCalls.filter((call) => isWithinFunction(call, cleanupFunction));
  const exactStartupTimer = startupTimers.length === 1 ? startupTimers[0] : undefined;
  const hasOneOuterDeadlineTimer = exactStartupTimer !== undefined &&
    nearestFunction(exactStartupTimer) === openFunction && exactStartupTimer.arguments.length >= 2 &&
    containsControllerAbort(exactStartupTimer.arguments[0]!) &&
    containsDeadlineSubtraction(exactStartupTimer.arguments[1]!);
  const cleanupBudgetDeclarations: ts.VariableDeclaration[] = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) ||
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) &&
        declaration.name.text === "STARTUP_CLOSE_TIMEOUT_MS" &&
        declaration.initializer && numericConstValue(declaration.initializer) === 5_000) {
        cleanupBudgetDeclarations.push(declaration);
      }
    }
  }
  const cleanupBudgetSymbol = cleanupBudgetDeclarations.length === 1 &&
    ts.isIdentifier(cleanupBudgetDeclarations[0]!.name)
    ? checker.getSymbolAtLocation(cleanupBudgetDeclarations[0]!.name)
    : undefined;
  const cleanupStartDeclarations: ts.VariableDeclaration[] = [];
  const cleanupLoops: ts.DoStatement[] = [];
  if (cleanupFunction?.body) {
    const collectCleanupBound = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && nearestFunction(node) === cleanupFunction &&
        ts.isIdentifier(node.name) && node.name.text === "cleanupStartedAt" &&
        node.initializer && isPerformanceNow(node.initializer) &&
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.Const) !== 0) {
        cleanupStartDeclarations.push(node);
      }
      if (ts.isDoStatement(node) && nearestFunction(node) === cleanupFunction) {
        cleanupLoops.push(node);
      }
      ts.forEachChild(node, collectCleanupBound);
    };
    collectCleanupBound(cleanupFunction.body);
  }
  const cleanupStartSymbol = cleanupStartDeclarations.length === 1 &&
    ts.isIdentifier(cleanupStartDeclarations[0]!.name)
    ? checker.getSymbolAtLocation(cleanupStartDeclarations[0]!.name)
    : undefined;
  const exactCleanupLoop = cleanupLoops.length === 1 ? cleanupLoops[0] : undefined;
  const hasExactCleanupDeadline = exactCleanupLoop !== undefined && (() => {
    const condition = unwrap(exactCleanupLoop.expression);
    if (!ts.isBinaryExpression(condition) ||
      condition.operatorToken.kind !== ts.SyntaxKind.LessThanToken ||
      !ts.isIdentifier(unwrap(condition.right)) ||
      checker.getSymbolAtLocation(unwrap(condition.right)) !== cleanupBudgetSymbol) return false;
    const elapsed = unwrap(condition.left);
    return ts.isBinaryExpression(elapsed) &&
      elapsed.operatorToken.kind === ts.SyntaxKind.MinusToken &&
      isPerformanceNow(elapsed.left) && ts.isIdentifier(unwrap(elapsed.right)) &&
      checker.getSymbolAtLocation(unwrap(elapsed.right)) === cleanupStartSymbol;
  })();
  const exactCleanupTimer = cleanupTimers.length === 1 ? cleanupTimers[0] : undefined;
  const hasResolveOnlyCleanupPoll = exactCleanupTimer !== undefined && (() => {
    if (exactCleanupTimer.arguments.length !== 2 ||
      numericConstValue(exactCleanupTimer.arguments[1]!) !== 25 ||
      !ts.isIdentifier(unwrap(exactCleanupTimer.arguments[0]!))) return false;
    const executor = nearestFunction(exactCleanupTimer);
    if (!executor || (!ts.isArrowFunction(executor) && !ts.isFunctionExpression(executor)) ||
      executor.parameters.length !== 1 || !ts.isIdentifier(executor.parameters[0]!.name) ||
      checker.getSymbolAtLocation(unwrap(exactCleanupTimer.arguments[0]!)) !==
        checker.getSymbolAtLocation(executor.parameters[0]!.name) ||
      ts.isBlock(executor.body) || unwrap(executor.body) !== exactCleanupTimer) return false;
    const promise = executor.parent;
    return ts.isNewExpression(promise) &&
      isUnshadowedGlobalIdentifier(unwrap(promise.expression), "Promise") &&
      promise.arguments?.length === 1 && promise.arguments[0] === executor &&
      ts.isAwaitExpression(promise.parent) && exactCleanupLoop !== undefined &&
      containsNode(exactCleanupLoop.statement, promise.parent);
  })();
  const hasOneBoundedCleanupPoll = cleanupFunctions.length === 1 &&
    cleanupFunction?.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true &&
    cleanupBudgetDeclarations.length === 1 && cleanupStartDeclarations.length === 1 &&
    hasExactCleanupDeadline && hasResolveOnlyCleanupPoll;
  return {
    valid: openFunctions.length === 1 && controllerConstructions.length === 1 &&
      controllerDeclarations.length === 1 &&
      perOpenControllers.length === 1 && deadlineDeclarations.length === 1 &&
      perOpenDeadlines.length === 1 && budgetMs === 5_000 &&
      deadlineWrites.length === 0 && independentSignalTimeouts === 0 &&
      timeoutCalls.length === 2 && hasOneOuterDeadlineTimer && hasOneBoundedCleanupPoll &&
      budgetedPhases.length === STARTUP_PHASES.length && negativeConcurrent && positiveConcurrent &&
      requiredBarriers.every((phase) => budgetedBarrierPhases.includes(phase)),
    openFunctions: openFunctions.length,
    controllers: controllerConstructions.length,
    deadlines: deadlineDeclarations.length,
    budgetMs,
    budgetedPhases,
    causallyBoundPhases,
    negativeConcurrent,
    positiveConcurrent,
    budgetedBarrierPhases,
  };
}

describe("distributed-execution database strangler", () => {
  it("inspects only enabled and allocates no serving connection while flag-off", async () => {
    let connectionAllocations = 0;
    type InputInspection = {
      readonly operation: "get" | "has" | "ownKeys" | "getOwnPropertyDescriptor";
      readonly property?: PropertyKey;
    };
    const makeTrappedInput = () => {
      const inspections: InputInspection[] = [];
      const target = {
        enabled: false,
        ownerDb: null,
        requiredMigrationIdentity: null,
        appDatabaseUrl: undefined,
        operatorDatabaseUrl: undefined,
      };
      const input = new Proxy(target, {
        get(candidate, property, receiver) {
          inspections.push({ operation: "get", property });
          if (property === "enabled") return Reflect.get(candidate, property, receiver);
          throw new Error(`flag-off get ${String(property)}`);
        },
        has(_candidate, property) {
          inspections.push({ operation: "has", property });
          throw new Error(`flag-off has ${String(property)}`);
        },
        ownKeys() {
          inspections.push({ operation: "ownKeys" });
          throw new Error("flag-off ownKeys");
        },
        getOwnPropertyDescriptor(_candidate, property) {
          inspections.push({ operation: "getOwnPropertyDescriptor", property });
          throw new Error(`flag-off getOwnPropertyDescriptor ${String(property)}`);
        },
      });
      return { input, inspections };
    };

    const hasControl = makeTrappedInput();
    expect(() => "ownerDb" in hasControl.input).toThrow("flag-off has ownerDb");
    expect(hasControl.inspections).toEqual([{ operation: "has", property: "ownerDb" }]);

    const getControl = makeTrappedInput();
    expect(() => getControl.input.ownerDb).toThrow("flag-off get ownerDb");
    expect(getControl.inspections).toEqual([{ operation: "get", property: "ownerDb" }]);

    const ownKeysControl = makeTrappedInput();
    expect(() => Reflect.ownKeys(ownKeysControl.input)).toThrow("flag-off ownKeys");
    expect(ownKeysControl.inspections).toEqual([{ operation: "ownKeys" }]);

    const descriptorControl = makeTrappedInput();
    expect(() => Object.getOwnPropertyDescriptor(descriptorControl.input, "ownerDb"))
      .toThrow("flag-off getOwnPropertyDescriptor ownerDb");
    expect(descriptorControl.inspections).toEqual([
      { operation: "getOwnPropertyDescriptor", property: "ownerDb" },
    ]);

    const spreadControl = makeTrappedInput();
    expect(() => ({ ...spreadControl.input })).toThrow("flag-off ownKeys");
    expect(spreadControl.inspections).toEqual([{ operation: "ownKeys" }]);

    vi.resetModules();
    vi.doMock("@armyofagents/db", async () => {
      const actual = await vi.importActual<typeof import("@armyofagents/db")>("@armyofagents/db");
      const rejectAllocation = () => {
        connectionAllocations += 1;
        throw new Error("flag-off attempted to allocate a serving connection");
      };
      return {
        ...actual,
        createTenantAppDbConnection: rejectAllocation,
        createOperatorDbConnection: rejectAllocation,
      };
    });
    try {
      const isolated = await import("../db/distributed-execution-databases.js");
      const realCall = makeTrappedInput();
      await expect(isolated.openDistributedExecutionDatabases(realCall.input as never)).resolves.toBeNull();
      expect(realCall.inspections).toEqual([{ operation: "get", property: "enabled" }]);
      expect(connectionAllocations).toBe(0);
    } finally {
      vi.doUnmock("@armyofagents/db");
      vi.resetModules();
    }
  });

  it.each([
    ["passwordless", ""],
    ["password-function", async () => "owner-password-sentinel"],
  ] as const)("clones the exact owner %s transport into the disposable control and disposes it", async (
    _credentialMode,
    pass,
  ) => {
    // Mutations caught: dropping a custom postgres.js socket or direct TLS negotiation silently
    // moves cancellation onto a different transport/domain even when host/database strings match.
    // The app participant is genuinely pending; only the compiled control cancellation SQL may
    // settle it after the exact per-open controller is externally aborted.
    const dialect = new PgDialect();
    type CompiledQuery = ReturnType<PgDialect["sqlToQuery"]>;
    const compile = (statement: unknown) => dialect.sqlToQuery(statement as never);
    const socket = vi.fn(async () => {
      throw new Error("the hermetic socket must never be opened");
    });
    const ownerOptions = {
      host: ["owner-primary.internal", "owner-standby.internal"],
      port: [5_432, 5_433],
      path: undefined,
      database: "aoa_control",
      user: "owner_transport_user",
      pass,
      ssl: "require" as const,
      sslnegotiation: "direct" as const,
      socket,
      connection: { application_name: "job003-owner-transport" },
      prepare: false,
      target_session_attrs: "primary" as const,
      fetch_types: true,
      types: {},
    };
    const ownerIdentity = {
      pid: 101,
      backend_start: "2026-08-12 00:00:00+00",
      role_name: "owner_transport_user",
      session_role: "owner_transport_user",
      session_user: "owner_transport_user",
      usename: "owner_transport_user",
      database_name: "aoa_control",
      datname: "aoa_control",
      application_name: "job003-owner-transport",
      session_tag: "job003-owner-transport",
    };
    const appIdentity = {
      pid: 202,
      backend_start: "2026-08-12 00:00:01+00",
      role_name: "aoa_app",
      session_role: "aoa_app",
      session_user: "aoa_app",
      usename: "aoa_app",
      database_name: "aoa_control",
      datname: "aoa_control",
      application_name: "job003-open-session-app",
      session_tag: "job003-open-session-app",
    };
    const cleanupReceipt = {
      participant_pids_gone: true,
      owner_out_of_transaction: true,
      advisory_locks_gone: true,
    };
    const queryText = (statement: unknown) => compile(statement).sql.toLowerCase();
    const ownerStatements: CompiledQuery[] = [];
    const ownerExecute = async (statement: unknown) => {
      const compiled = compile(statement);
      ownerStatements.push(compiled);
      const text = compiled.sql.toLowerCase();
      if (text.includes("__drizzle_migrations")) {
        return [{ id: 1, hash: HERMETIC_MIGRATION_HASH }];
      }
      if (text.includes("participant_pids_gone")) return [cleanupReceipt];
      if (text.includes("pg_backend_pid") || text.includes("backend_start")) {
        return [ownerIdentity];
      }
      return [];
    };
    const ownerDb = {
      execute: ownerExecute,
      $client: { options: ownerOptions },
      transaction: async (callback: (transaction: unknown) => unknown) => {
        return callback({ execute: ownerExecute });
      },
    };

    let markAppPending!: () => void;
    const appPendingStarted = new Promise<void>((resolve) => { markAppPending = resolve; });
    let rejectAppPending!: (error: unknown) => void;
    const appPending = new Promise<never>((_resolve, reject) => { rejectAppPending = reject; });
    let appCancellationDelivered = false;
    const appExecute = async (statement: unknown) => {
      const text = queryText(statement);
      if (text.includes("session_role_name")) {
        markAppPending();
        return appPending;
      }
      if (text.includes("pg_backend_pid") || text.includes("backend_start")) return [appIdentity];
      return [];
    };
    const appDb = {
      execute: appExecute,
      transaction: async (callback: (transaction: unknown) => unknown) =>
        callback({ execute: appExecute }),
    };
    const appClose = vi.fn(async () => {});
    const appFactory = vi.fn(() => ({ db: appDb, close: appClose }));
    const operatorFactory = vi.fn(() => {
      throw new Error("operator factory must not be reached");
    });

    const controls: Array<{
      options: Record<string, unknown>;
      client: { end: ReturnType<typeof vi.fn> };
      end: ReturnType<typeof vi.fn>;
      statements: CompiledQuery[];
    }> = [];
    const postgresFactory = vi.fn((options: Record<string, unknown>) => {
      const end = vi.fn(async () => {});
      const client = { end };
      controls.push({ options, client, end, statements: [] });
      return client;
    });
    const executeControl = async (
      control: (typeof controls)[number],
      statement: unknown,
    ) => {
      const compiled = compile(statement);
      control.statements.push(compiled);
      const text = compiled.sql.toLowerCase();
      if (text.includes("pg_cancel_backend")) {
        if (!appCancellationDelivered) {
          appCancellationDelivered = true;
          rejectAppPending(Object.assign(new Error("hermetic app query cancelled by control SQL"), {
            code: "57014",
          }));
        }
        return [{ cancelled: true }];
      }
      if (text.includes("participant_pids_gone")) return [cleanupReceipt];
      if (text.includes("__drizzle_migrations")) {
        return [{ id: 1, hash: HERMETIC_MIGRATION_HASH }];
      }
      if (text.includes("control_pid")) return [{ control_pid: 999 }];
      if (text.includes("pg_backend_pid") || text.includes("backend_start")) {
        return [ownerIdentity];
      }
      return [];
    };
    const logs: unknown[][] = [];
    const NativeAbortController = globalThis.AbortController;
    const controllers: AbortController[] = [];
    class ObservedAbortController extends NativeAbortController {
      constructor() {
        super();
        controllers.push(this);
      }
    }
    const observeWithin = async <T>(promise: Promise<T>, timeoutMs: number) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          promise.then(
            (value) => ({ kind: "fulfilled" as const, value }),
            (error: unknown) => ({ kind: "rejected" as const, error }),
          ),
          new Promise<{ kind: "watchdog" }>((resolve) => {
            timer = setTimeout(() => resolve({ kind: "watchdog" }), timeoutMs);
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    };

    vi.resetModules();
    vi.doMock("postgres", () => ({ default: postgresFactory }));
    vi.doMock("drizzle-orm/postgres-js", async () => {
      const actual = await vi.importActual<typeof import("drizzle-orm/postgres-js")>(
        "drizzle-orm/postgres-js",
      );
      return { ...actual, drizzle: (client: unknown) => {
        const control = controls.find((candidate) => candidate.client === client);
        if (!control) throw new Error("unregistered hermetic owner control");
        const execute = (statement: unknown) => executeControl(control, statement);
        return {
          execute,
          transaction: async (callback: (transaction: unknown) => unknown) =>
            callback({ execute }),
        };
      } };
    });
    vi.doMock("@armyofagents/db", async () => {
      const actual = await vi.importActual<typeof import("@armyofagents/db")>("@armyofagents/db");
      return {
        ...actual,
        createTenantAppDbConnection: appFactory,
        createOperatorDbConnection: operatorFactory,
      };
    });
    vi.doMock("../middleware/logger.js", () => ({
      logger: { error: (...args: unknown[]) => { logs.push(args); } },
    }));
    globalThis.AbortController = ObservedAbortController;
    try {
      const isolated = await import("../db/distributed-execution-databases.js");
      controllers.length = 0;
      const operation = isolated.openDistributedExecutionDatabases({
        enabled: true,
        ownerDb: ownerDb as never,
        requiredMigrationIdentity: HERMETIC_MIGRATION_IDENTITY,
        appDatabaseUrl: "postgres://app-user:app-secret@app.internal/aoa_control",
        operatorDatabaseUrl: "postgres://operator-user:operator-secret@operator.internal/aoa_control",
      });
      void operation.catch(() => {});
      expect(await observeWithin(appPendingStarted, 2_000)).toMatchObject({ kind: "fulfilled" });
      expect(controllers).toHaveLength(1);
      expect(controllers[0]?.signal.aborted).toBe(false);
      controllers[0]!.abort();
      const outcome = await observeWithin(operation, 5_000);
      expect(outcome).toMatchObject({
        kind: "rejected",
        error: {
        name: "DistributedExecutionStartupError",
          message: "distributed_execution_timeout",
        },
      });

      expect(appFactory).toHaveBeenCalledOnce();
      expect(operatorFactory).not.toHaveBeenCalled();
      expect(appClose).toHaveBeenCalledOnce();
      expect(appClose).toHaveBeenCalledWith({ timeoutSeconds: 5 });
      expect(appCancellationDelivered).toBe(true);
      expect(controls.length).toBeGreaterThan(0);
      for (const control of controls) {
        expect(control.options.password).toBe(pass);
        expect(control.options).toMatchObject({
          host: ownerOptions.host,
          port: ownerOptions.port,
          path: ownerOptions.path,
          database: ownerOptions.database,
          user: ownerOptions.user,
          ssl: ownerOptions.ssl,
          connection: {
            statement_timeout: 5_000,
            lock_timeout: 750,
            idle_in_transaction_session_timeout: 5_000,
          },
          prepare: false,
          target_session_attrs: "primary",
          fetch_types: true,
          types: {},
          debug: false,
          max: 1,
          connect_timeout: 5,
          idle_timeout: 1,
        });
        expect(control.end).toHaveBeenCalledOnce();
        expect(control.end).toHaveBeenCalledWith({ timeout: 5 });
      }
      expect(socket).not.toHaveBeenCalled();
      expect(JSON.stringify(logs)).not.toContain("owner-password-sentinel");
      expect(logs).toEqual([[
        { code: "distributed_execution_timeout", phase: "app-authority" },
        "distributed execution startup rejected",
      ]]);

      const controlStatements = controls.flatMap(({ statements }) => statements);
      expect([...ownerStatements, ...controlStatements]
        .some(({ sql: text }) => text.toLowerCase().includes("__drizzle_migrations"))).toBe(true);
      const cancellationQueries = controlStatements
        .filter(({ sql: text }) => text.toLowerCase().includes("pg_cancel_backend"));
      expect(cancellationQueries).toHaveLength(1);
      const cancellationSql = cancellationQueries[0]!.sql.toLowerCase();
      const cancellationParams = cancellationQueries[0]!.params;
      expect({
        socket: controls.every(({ options }) => options.socket === socket),
        sslnegotiation: controls.every(({ options }) => options.sslnegotiation === "direct"),
        backendStartColumn: /\bbackend_start\b/u.test(cancellationSql),
        roleColumn: /\b(?:usename|session_role|role_name|current_user|session_user)\b/u
          .test(cancellationSql),
        databaseColumn: /\b(?:datname|database_name|current_database)\b/u.test(cancellationSql),
        sessionTagColumn: /\b(?:application_name|session_tag|open_tag|control_tag)\b/u
          .test(cancellationSql),
        pidParameter: cancellationParams.some((parameter) =>
          typeof parameter === "number" && parameter === appIdentity.pid),
        backendStartParameter: cancellationParams.some((parameter) =>
          typeof parameter === "string" && parameter === appIdentity.backend_start),
        roleParameter: cancellationParams.some((parameter) =>
          typeof parameter === "string" && parameter === appIdentity.session_role),
        databaseParameter: cancellationParams.some((parameter) =>
          typeof parameter === "string" && parameter === appIdentity.database_name),
        sessionTagParameter: cancellationParams.some((parameter) =>
          typeof parameter === "string" && parameter === appIdentity.application_name),
      }).toEqual({
        socket: true,
        sslnegotiation: true,
        backendStartColumn: true,
        roleColumn: true,
        databaseColumn: true,
        sessionTagColumn: true,
        pidParameter: true,
        backendStartParameter: true,
        roleParameter: true,
        databaseParameter: true,
        sessionTagParameter: true,
      });
    } finally {
      globalThis.AbortController = NativeAbortController;
      vi.doUnmock("postgres");
      vi.doUnmock("drizzle-orm/postgres-js");
      vi.doUnmock("@armyofagents/db");
      vi.doUnmock("../middleware/logger.js");
      vi.resetModules();
    }
  });

  it.each([
    {
      targetRole: "app" as const,
      appDatabaseUrl:
        "postgres://app-user:app-secret@app-a.internal:5432,app-b.internal:5433/aoa_control",
      operatorDatabaseUrl:
        "postgres://operator-user:operator-secret@operator.internal/aoa_control",
      expectedCode: "distributed_execution_app_authority",
    },
    {
      targetRole: "operator" as const,
      appDatabaseUrl: "postgres://app-user:app-secret@app.internal/aoa_control",
      operatorDatabaseUrl:
        "postgres://operator-user:operator-secret@operator-a.internal:5432,operator-b.internal:5433/aoa_control",
      expectedCode: "distributed_execution_operator_authority",
    },
  ])("accepts a postgres.js multi-host URL with per-host ports for the $targetRole factory", async ({
    targetRole,
    appDatabaseUrl,
    operatorDatabaseUrl,
    expectedCode,
  }) => {
    // postgres.js parses each authority list into two hosts/two ports without opening a socket.
    // WHATWG URL rejects it; using URL as either serving-role validator rejects valid configs.
    const factoryUrls = {
      app: [] as string[],
      operator: [] as string[],
    };
    const targetFailure = new Error(`multi-host URL reached the ${targetRole} factory`);
    const controlEnd = vi.fn(async () => {});
    const controlClient = { end: controlEnd };
    const controlOptions: Array<Record<string, unknown>> = [];
    const postgresFactory = vi.fn((options: Record<string, unknown>) => {
      controlOptions.push(options);
      return controlClient;
    });
    const controlDb = {
      transaction: async (callback: (transaction: unknown) => unknown) => {
        return callback({
          execute: async () => [{
            control_pid: 999,
            participant_pids_gone: true,
            owner_out_of_transaction: true,
            advisory_locks_gone: true,
          }],
        });
      },
    };
    const dialect = new PgDialect();
    const appExecute = async (statement: unknown) => {
      const text = dialect.sqlToQuery(statement as never).sql.toLowerCase();
      if (text.includes("pg_backend_pid")) {
        return [{
          pid: 202,
          backend_start: "2026-08-12 00:00:01+00",
          session_role: "aoa_app",
          database_name: "aoa_control",
          application_name: "job003-multihost-app",
        }];
      }
      if (text.includes("session_role_name")) {
        return [{
          session_role_name: "aoa_app",
          role_name: "aoa_app",
          rolsuper: false,
          rolbypassrls: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolinherit: false,
          rolreplication: false,
          membership_count: 0,
          owns_application_objects: false,
        }];
      }
      return [];
    };
    const appClose = vi.fn(async () => {});
    const appConnection = {
      db: {
        execute: appExecute,
        transaction: async (callback: (transaction: unknown) => unknown) =>
          callback({ execute: appExecute }),
      },
      close: appClose,
    };
    const { ownerDb } = createHermeticOwnerDb({
      host: ["owner.internal"],
      port: [5_432],
      path: undefined,
      database: "aoa_control",
      user: "owner",
      pass: "",
      ssl: false,
      connection: {},
      prepare: false,
      target_session_attrs: null,
      fetch_types: true,
      types: {},
    });

    vi.resetModules();
    vi.doMock("postgres", () => ({ default: postgresFactory }));
    vi.doMock("drizzle-orm/postgres-js", async () => {
      const actual = await vi.importActual<typeof import("drizzle-orm/postgres-js")>(
        "drizzle-orm/postgres-js",
      );
      return { ...actual, drizzle: () => controlDb };
    });
    vi.doMock("@armyofagents/db", async () => {
      const actual = await vi.importActual<typeof import("@armyofagents/db")>("@armyofagents/db");
      return {
        ...actual,
        createTenantAppDbConnection: (url: string) => {
          factoryUrls.app.push(url);
          if (targetRole === "app") throw targetFailure;
          return appConnection;
        },
        createOperatorDbConnection: (url: string) => {
          factoryUrls.operator.push(url);
          throw targetFailure;
        },
      };
    });
    vi.doMock("../db/job-control-legacy-grants.js", async () => {
      const actual = await vi.importActual<typeof import("../db/job-control-legacy-grants.js")>(
        "../db/job-control-legacy-grants.js",
      );
      return {
        ...actual,
        APP_EXECUTION_TARGET_COLUMN_GRANTS: [],
        APP_ENROLLMENT_TARGET_SELECT_COLUMNS: [],
        APP_ENROLLMENT_TARGET_UPDATE_COLUMNS: [],
        APP_JOB_PLACEMENT_TARGET_SELECT_COLUMNS: [],
        APP_JOB_PLACEMENT_TARGET_UPDATE_COLUMNS: [],
        APP_MCP_API_KEY_COLUMN_GRANTS: [],
        JOB_CONTROL_LEGACY_GRANTS: {},
        JOB_CONTROL_NEW_PATH_GRANTS: {},
        JOB_LEASING_NEW_PATH_GRANTS: {},
        JOB_SUBMISSION_LEGACY_GRANTS: {},
        JOB_SUBMISSION_NEW_PATH_GRANTS: {},
        OPERATOR_METADATA_COLUMN_GRANTS: {},
        OPERATOR_ENROLLMENT_TARGET_SELECT_COLUMNS: [],
        OPERATOR_ENROLLMENT_TARGET_UPDATE_COLUMNS: [],
        OPERATOR_JOB_PLACEMENT_TARGET_SELECT_COLUMNS: [],
        OPERATOR_JOB_PLACEMENT_TARGET_UPDATE_COLUMNS: [],
        APP_SERVING_RELATIONS: [],
        COLUMN_ACL_MANIFEST: {},
        FORCE_RLS_RELATIONS: [],
        NON_FORCE_RLS_RELATIONS: [],
        POLICY_COUNTS: {},
        RELATION_ACL_MANIFEST: {},
        RLS_POLICY_MANIFEST: [],
        RLS_RELATIONS: [],
        WORKER_ENROLLMENT_APP_GRANTS: {},
        WORKER_ENROLLMENT_OPERATOR_GRANTS: {},
      };
    });
    vi.doMock("../middleware/logger.js", () => ({
      logger: { error: vi.fn() },
    }));
    try {
      const isolated = await import("../db/distributed-execution-databases.js");
      if (targetRole === "operator") {
        const controlOperatorUrl =
          "postgres://operator-user:operator-secret@operator.internal/aoa_control";
        const controlOutcome = await isolated.openDistributedExecutionDatabases({
          enabled: true,
          ownerDb: ownerDb as never,
          requiredMigrationIdentity: HERMETIC_MIGRATION_IDENTITY,
          appDatabaseUrl,
          operatorDatabaseUrl: controlOperatorUrl,
        }).then(
          () => ({ kind: "fulfilled" as const, error: null }),
          (error: unknown) => ({ kind: "rejected" as const, error }),
        );
        expect({
          kind: controlOutcome.kind,
          message: controlOutcome.kind === "rejected"
            ? (controlOutcome.error as { message?: unknown }).message
            : null,
          appFactoryUrls: factoryUrls.app,
          operatorFactoryUrls: factoryUrls.operator,
          appCloseCalls: appClose.mock.calls.length,
        }).toEqual({
          kind: "rejected",
          message: "distributed_execution_operator_authority",
          appFactoryUrls: [appDatabaseUrl],
          operatorFactoryUrls: [controlOperatorUrl],
          appCloseCalls: 1,
        });
        factoryUrls.app.length = 0;
        factoryUrls.operator.length = 0;
        controlOptions.length = 0;
        appClose.mockClear();
        controlEnd.mockClear();
      }
      const outcome = await isolated.openDistributedExecutionDatabases({
        enabled: true,
        ownerDb: ownerDb as never,
        requiredMigrationIdentity: HERMETIC_MIGRATION_IDENTITY,
        appDatabaseUrl,
        operatorDatabaseUrl,
      }).then(
        () => ({ kind: "fulfilled" as const, error: null }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      );
      expect({
        kind: outcome.kind,
        error: outcome.kind === "rejected" ? {
          name: (outcome.error as { name?: unknown }).name,
          message: (outcome.error as { message?: unknown }).message,
        } : null,
        appFactoryUrls: factoryUrls.app,
        operatorFactoryUrls: factoryUrls.operator,
        appCloseCalls: appClose.mock.calls.length,
        controlsDisposed: controlEnd.mock.calls.length === controlOptions.length &&
          controlEnd.mock.calls.every((call) => JSON.stringify(call) === JSON.stringify([{ timeout: 5 }])),
      }).toEqual({
        kind: "rejected",
        error: { name: "DistributedExecutionStartupError", message: expectedCode },
        appFactoryUrls: [appDatabaseUrl],
        operatorFactoryUrls: targetRole === "operator" ? [operatorDatabaseUrl] : [],
        appCloseCalls: targetRole === "operator" ? 1 : 0,
        controlsDisposed: true,
      });
    } finally {
      vi.doUnmock("postgres");
      vi.doUnmock("drizzle-orm/postgres-js");
      vi.doUnmock("@armyofagents/db");
      vi.doUnmock("../db/job-control-legacy-grants.js");
      vi.doUnmock("../middleware/logger.js");
      vi.resetModules();
    }
  });

  it.each((["app", "operator"] as const).flatMap((targetRole) => [
    "postgres://target-user:target-secret@target-a.internal:5432,,target-b.internal:5433/aoa_control",
    "postgres://target-user:target-secret@target-a.internal:not-a-port,target-b.internal:5433/aoa_control",
    "postgres://target-user:target-secret@target-a.internal:5432,target-b.internal:5433/",
  ].map((malformedUrl) => [targetRole, malformedUrl] as const)))(
    "rejects malformed %s multi-host database URL %s before either serving factory",
    async (targetRole, malformedUrl) => {
    const appFactory = vi.fn();
    const operatorFactory = vi.fn();
    const { ownerDb } = createHermeticOwnerDb({
      host: ["owner.internal"],
      port: [5_432],
      path: undefined,
      database: "aoa_control",
      user: "owner",
      pass: "",
      ssl: false,
      connection: {},
      prepare: false,
      target_session_attrs: null,
      fetch_types: true,
      types: {},
    });
    vi.resetModules();
    vi.doMock("@armyofagents/db", async () => {
      const actual = await vi.importActual<typeof import("@armyofagents/db")>("@armyofagents/db");
      return {
        ...actual,
        createTenantAppDbConnection: appFactory,
        createOperatorDbConnection: operatorFactory,
      };
    });
    vi.doMock("../middleware/logger.js", () => ({ logger: { error: vi.fn() } }));
    try {
      const isolated = await import("../db/distributed-execution-databases.js");
      await expect(isolated.openDistributedExecutionDatabases({
        enabled: true,
        ownerDb: ownerDb as never,
        requiredMigrationIdentity: HERMETIC_MIGRATION_IDENTITY,
        appDatabaseUrl: targetRole === "app"
          ? malformedUrl
          : "postgres://app-user:app-secret@app.internal/aoa_control",
        operatorDatabaseUrl: targetRole === "operator"
          ? malformedUrl
          : "postgres://operator-user:operator-secret@operator.internal/aoa_control",
      })).rejects.toMatchObject({
        name: "DistributedExecutionStartupError",
        message: "distributed_execution_configuration",
      });
      expect(appFactory).not.toHaveBeenCalled();
      expect(operatorFactory).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("@armyofagents/db");
      vi.doUnmock("../middleware/logger.js");
      vi.resetModules();
    }
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

  it("requires the exact unconditional owner and migration-identity startup inputs", () => {
    // Mutation caught: optional owner/identity properties let a flag-on JavaScript caller enter
    // cleanup with unusable control-plane state and mask configuration as a close failure.
    const sourceText = readFileSync(
      new URL("../db/distributed-execution-databases.ts", import.meta.url),
      "utf8",
    );
    const source = ts.createSourceFile(
      "distributed-execution-databases.ts",
      sourceText,
      ts.ScriptTarget.Latest,
      true,
    );
    const open = findExportedOpenFunction(source);
    const inputType = open?.parameters[0]?.type;
    expect(open?.parameters).toHaveLength(1);
    expect(inputType && ts.isTypeLiteralNode(inputType)).toBe(true);
    if (!inputType || !ts.isTypeLiteralNode(inputType)) return;

    const properties = inputType.members.filter((member): member is ts.PropertySignature =>
      ts.isPropertySignature(member) && ts.isIdentifier(member.name));
    expect(properties.map((property) => property.name.getText(source))).toEqual([
      "enabled",
      "ownerDb",
      "requiredMigrationIdentity",
      "appDatabaseUrl",
      "operatorDatabaseUrl",
    ]);
    expect(properties.map((property) => property.questionToken === undefined)).toEqual([
      true, true, true, true, true,
    ]);
    expect(Object.fromEntries(properties.map((property) => [
      property.name.getText(source),
      property.type?.getText(source).replaceAll(/\s+/g, " "),
    ]))).toEqual({
      enabled: "boolean",
      ownerDb: "Db",
      requiredMigrationIdentity: "RequiredMigrationIdentity",
      appDatabaseUrl: "string | undefined",
      operatorDatabaseUrl: "string | undefined",
    });
  });

  it("owns exactly one immutable deadline and one shared abort controller for the complete startup", () => {
    const strictValidFixture = `
      const STARTUP_HANDSHAKE_TIMEOUT_MS = 5_000;
      const STARTUP_CLOSE_TIMEOUT_MS = 5_000;
      async function assertTrackedParticipantsClosed() {
        const cleanupStartedAt = performance.now();
        do {
          if (await cleanupSettled()) return;
          await new Promise<void>((resolve) => setTimeout(resolve, 25));
        } while (performance.now() - cleanupStartedAt < STARTUP_CLOSE_TIMEOUT_MS);
        throw new Error("cleanup did not settle");
      }
      export async function openDistributedExecutionDatabases() {
        const startupAbort = new AbortController();
        const startupDeadline = performance.now() + STARTUP_HANDSHAKE_TIMEOUT_MS;
        const startupTimer = setTimeout(
          () => startupAbort.abort(),
          Math.max(0, startupDeadline - performance.now()),
        );
        try {
          const runPhase = async (_phase: string, work: () => Promise<unknown>) => {
            const cancellation = new Promise<never>((_resolve, reject) => {
              startupAbort.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            });
            return await Promise.race([work(), cancellation]);
          };
          await runPhase("migration-identity", async () => await migrationIdentity());
          await runPhase("app-authority", async () => await appAuthority());
          await runPhase("operator-authority", async () => await operatorAuthority());
          await runPhase("owner-exclusive", async () => { await ownerBarrier.wait(); });
          await Promise.all([
            runPhase("app-negative", async () => await appProbe()),
            runPhase("operator-negative", async () => await operatorProbe()),
          ]);
          await Promise.all([
            runPhase("app-positive", async () => { await appBarrier.wait(); }),
            runPhase("operator-positive", async () => { await operatorBarrier.wait(); }),
          ]);
        } finally {
          clearTimeout(startupTimer);
        }
      }
    `;
    expect(analyzeSharedStartupBudget(strictValidFixture)).toEqual({
      valid: true,
      openFunctions: 1,
      controllers: 1,
      deadlines: 1,
      budgetMs: 5_000,
      budgetedPhases: [...STARTUP_PHASES],
      causallyBoundPhases: [...STARTUP_PHASES],
      negativeConcurrent: true,
      positiveConcurrent: true,
      budgetedBarrierPhases: ["owner-exclusive", "app-positive", "operator-positive"],
    });

    const qualifiedCleanupPollFixture = strictValidFixture.replace(
      "setTimeout(resolve, 25)",
      "globalThis.setTimeout(resolve, 25)",
    );
    const aliasedCleanupPollFixture = strictValidFixture
      .replace(
        "const STARTUP_CLOSE_TIMEOUT_MS = 5_000;",
        `const STARTUP_CLOSE_TIMEOUT_MS = 5_000;
         const scheduleCleanupPoll = globalThis.setTimeout;`,
      )
      .replace("setTimeout(resolve, 25)", "scheduleCleanupPoll(resolve, 25)");
    for (const validCleanupPoll of [qualifiedCleanupPollFixture, aliasedCleanupPollFixture]) {
      expect(analyzeSharedStartupBudget(validCleanupPoll)).toMatchObject({
        valid: true,
        controllers: 1,
        deadlines: 1,
        budgetMs: 5_000,
        budgetedPhases: STARTUP_PHASES,
        causallyBoundPhases: STARTUP_PHASES,
      });
    }

    const slowCleanupPoll = strictValidFixture.replace(
      "setTimeout(resolve, 25)",
      "setTimeout(resolve, 250)",
    );
    const rejectingCleanupPoll = strictValidFixture.replace(
      "new Promise<void>((resolve) => setTimeout(resolve, 25))",
      "new Promise<void>((resolve, reject) => setTimeout(reject, 25))",
    );
    const unboundedCleanupPoll = strictValidFixture.replace(
      "performance.now() - cleanupStartedAt < STARTUP_CLOSE_TIMEOUT_MS",
      "performance.now() - cleanupStartedAt < 50_000",
    );
    const extraCleanupTimer = strictValidFixture.replace(
      "if (await cleanupSettled()) return;",
      `if (await cleanupSettled()) return;
          globalThis.setTimeout(() => undefined, 25);`,
    );
    const shadowedPromiseCleanupPoll = strictValidFixture.replace(
      "async function assertTrackedParticipantsClosed() {",
      `async function assertTrackedParticipantsClosed() {
        const Promise = class NeverSettles<T> {
          constructor(_executor: (
            resolve: (value: T) => void,
            reject: (reason: unknown) => void,
          ) => void) {}
          then(
            _resolve: (value: T) => void,
            _reject: (reason: unknown) => void,
          ): void {}
        };`,
    );
    const shadowedPerformanceCleanupPoll = strictValidFixture.replace(
      "async function assertTrackedParticipantsClosed() {",
      `async function assertTrackedParticipantsClosed() {
        const performance = { now: () => 0 };`,
    );
    for (const invalidCleanupPoll of [
      slowCleanupPoll,
      rejectingCleanupPoll,
      unboundedCleanupPoll,
      extraCleanupTimer,
      shadowedPromiseCleanupPoll,
      shadowedPerformanceCleanupPoll,
    ]) {
      expect(analyzeSharedStartupBudget(invalidCleanupPoll)).toMatchObject({
        valid: false,
        controllers: 1,
        deadlines: 1,
        budgetMs: 5_000,
        budgetedPhases: STARTUP_PHASES,
        causallyBoundPhases: STARTUP_PHASES,
        negativeConcurrent: true,
        positiveConcurrent: true,
        budgetedBarrierPhases: ["owner-exclusive", "app-positive", "operator-positive"],
      });
    }

    const qualifiedStrictValidFixture = strictValidFixture
      .replace("new AbortController()", "new globalThis.AbortController()")
      .replace("const startupTimer = setTimeout(", "const startupTimer = globalThis.setTimeout(");
    expect(analyzeSharedStartupBudget(qualifiedStrictValidFixture)).toMatchObject({
      valid: true,
      controllers: 1,
      budgetedPhases: STARTUP_PHASES,
      causallyBoundPhases: STARTUP_PHASES,
    });

    const aliasedStrictValidFixture = strictValidFixture
      .replace(
        "const STARTUP_HANDSHAKE_TIMEOUT_MS = 5_000;",
        `const STARTUP_HANDSHAKE_TIMEOUT_MS = 5_000;
         const SharedAbortController = globalThis.AbortController;
         const scheduleStartupTimeout = globalThis.setTimeout;`,
      )
      .replace("new AbortController()", "new SharedAbortController()")
      .replace("const startupTimer = setTimeout(", "const startupTimer = scheduleStartupTimeout(");
    expect(analyzeSharedStartupBudget(aliasedStrictValidFixture)).toMatchObject({
      valid: true,
      controllers: 1,
      budgetedPhases: STARTUP_PHASES,
      causallyBoundPhases: STARTUP_PHASES,
    });

    const instanceAliasedStrictValidFixture = strictValidFixture
      .replace(
        "const startupDeadline = performance.now() + STARTUP_HANDSHAKE_TIMEOUT_MS;",
        `const startupDeadline = performance.now() + STARTUP_HANDSHAKE_TIMEOUT_MS;
         const sharedStartupAbort = startupAbort;`,
      )
      .replace("() => startupAbort.abort()", "() => sharedStartupAbort.abort()")
      .replace("startupAbort.signal.addEventListener", "sharedStartupAbort.signal.addEventListener");
    expect(analyzeSharedStartupBudget(instanceAliasedStrictValidFixture)).toMatchObject({
      valid: true,
      controllers: 1,
      budgetedPhases: STARTUP_PHASES,
      causallyBoundPhases: STARTUP_PHASES,
    });

    const executedQualifiedTimer = strictValidFixture.replace(
      `              startupAbort.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });`,
      `              startupAbort.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
              globalThis.setTimeout(() => reject(new Error("qualified phase timer")), 1_000);`,
    );
    const executedAliasedTimer = strictValidFixture
      .replace(
        `          const runPhase = async (_phase: string, work: () => Promise<unknown>) => {`,
        `          const schedulePhaseTimer = globalThis.setTimeout;
          const runPhase = async (_phase: string, work: () => Promise<unknown>) => {`,
      )
      .replace(
        `              startupAbort.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });`,
        `              startupAbort.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
              schedulePhaseTimer(() => reject(new Error("aliased phase timer")), 1_000);`,
      );
    const executedQualifiedController = strictValidFixture
      .replace(
        "export async function openDistributedExecutionDatabases() {",
        `function makeUnrelatedController() {
           return new globalThis.AbortController();
         }
         export async function openDistributedExecutionDatabases() {`,
      )
      .replace(
        "const startupAbort = new AbortController();",
        `const unrelatedAbort = makeUnrelatedController();
        void unrelatedAbort;
        const startupAbort = new AbortController();`,
      );
    const executedAliasedController = strictValidFixture
      .replace(
        "export async function openDistributedExecutionDatabases() {",
        `const UnrelatedAbortController = globalThis.AbortController;
         function makeUnrelatedController() {
           return new UnrelatedAbortController();
         }
         export async function openDistributedExecutionDatabases() {`,
      )
      .replace(
        "const startupAbort = new AbortController();",
        `const unrelatedAbort = makeUnrelatedController();
        void unrelatedAbort;
        const startupAbort = new AbortController();`,
      );
    for (const [executedAdversary, expectedControllers] of [
      [executedQualifiedTimer, 1],
      [executedAliasedTimer, 1],
      [executedQualifiedController, 2],
      [executedAliasedController, 2],
    ] as const) {
      expect(analyzeSharedStartupBudget(executedAdversary)).toMatchObject({
        valid: false,
        openFunctions: 1,
        controllers: expectedControllers,
        deadlines: 1,
        budgetMs: 5_000,
        budgetedPhases: STARTUP_PHASES,
        causallyBoundPhases: STARTUP_PHASES,
        negativeConcurrent: true,
        positiveConcurrent: true,
        budgetedBarrierPhases: ["owner-exclusive", "app-positive", "operator-positive"],
      });
    }

    const qualifiedTimerOutsideOpen = strictValidFixture.replace(
      "export async function openDistributedExecutionDatabases() {",
      `function armUnrelatedTimeout() {
         return globalThis.setTimeout(() => undefined, 60_000);
       }
       void armUnrelatedTimeout;
       export async function openDistributedExecutionDatabases() {`,
    );
    const aliasedTimerOutsideOpen = strictValidFixture.replace(
      "export async function openDistributedExecutionDatabases() {",
      `const scheduleUnrelatedTimeout = globalThis.setTimeout;
       function armUnrelatedTimeout() {
         return scheduleUnrelatedTimeout(() => undefined, 60_000);
       }
       void armUnrelatedTimeout;
       export async function openDistributedExecutionDatabases() {`,
    );
    const qualifiedControllerOutsideOpen = strictValidFixture.replace(
      "export async function openDistributedExecutionDatabases() {",
      `function makeUnrelatedController() {
         return new globalThis.AbortController();
       }
       void makeUnrelatedController;
       export async function openDistributedExecutionDatabases() {`,
    );
    const aliasedControllerOutsideOpen = strictValidFixture.replace(
      "export async function openDistributedExecutionDatabases() {",
      `const UnrelatedAbortController = globalThis.AbortController;
       function makeUnrelatedController() {
         return new UnrelatedAbortController();
       }
       void makeUnrelatedController;
       export async function openDistributedExecutionDatabases() {`,
    );
    for (const [wholeCandidateAdversary, expectedControllers] of [
      [qualifiedTimerOutsideOpen, 1],
      [aliasedTimerOutsideOpen, 1],
      [qualifiedControllerOutsideOpen, 2],
      [aliasedControllerOutsideOpen, 2],
    ] as const) {
      expect(analyzeSharedStartupBudget(wholeCandidateAdversary)).toMatchObject({
        valid: false,
        openFunctions: 1,
        controllers: expectedControllers,
        deadlines: 1,
        budgetMs: 5_000,
        budgetedPhases: STARTUP_PHASES,
        causallyBoundPhases: STARTUP_PHASES,
        negativeConcurrent: true,
        positiveConcurrent: true,
        budgetedBarrierPhases: ["owner-exclusive", "app-positive", "operator-positive"],
      });
    }

    const validSharedBudgetPlusIndependentPhaseTimer = strictValidFixture.replace(
      `              startupAbort.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });`,
      `              startupAbort.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
              setTimeout(() => reject(new Error("independent phase timeout")), 1_000);`,
    );
    expect(validSharedBudgetPlusIndependentPhaseTimer).not.toBe(strictValidFixture);
    expect(analyzeSharedStartupBudget(validSharedBudgetPlusIndependentPhaseTimer)).toMatchObject({
      valid: false,
      controllers: 1,
      deadlines: 1,
      budgetMs: 5_000,
      budgetedPhases: STARTUP_PHASES,
      causallyBoundPhases: STARTUP_PHASES,
    });

    const moduleScopedFreshness = `
      const STARTUP_HANDSHAKE_TIMEOUT_MS = 5_000;
      const startupAbort = new AbortController();
      const startupDeadline = performance.now() + STARTUP_HANDSHAKE_TIMEOUT_MS;
      export async function openDistributedExecutionDatabases() {
        const runPhase = async (_phase: string, work: () => Promise<unknown>) => {
          const cancellation = new Promise<never>((_resolve, reject) => {
            startupAbort.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            setTimeout(() => startupAbort.abort(), startupDeadline - performance.now());
          });
          return await Promise.race([work(), cancellation]);
        };
        await runPhase("migration-identity", async () => await migrationIdentity());
        await runPhase("app-authority", async () => await appAuthority());
        await runPhase("operator-authority", async () => await operatorAuthority());
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
    `;
    expect(analyzeSharedStartupBudget(moduleScopedFreshness).valid).toBe(false);

    const eightSecondDeadline = strictValidFixture.replace(
      "const STARTUP_HANDSHAKE_TIMEOUT_MS = 5_000;",
      "const STARTUP_HANDSHAKE_TIMEOUT_MS = 8_000;",
    );
    expect(analyzeSharedStartupBudget(eightSecondDeadline)).toMatchObject({
      valid: false,
      budgetMs: 8_000,
    });

    const dummyOuterBudget = `
      const STARTUP_HANDSHAKE_TIMEOUT_MS = 5_000;
      export async function openDistributedExecutionDatabases() {
        const startupAbort = new AbortController();
        const startupDeadline = performance.now() + STARTUP_HANDSHAKE_TIMEOUT_MS;
        const observeBudget = async () => {
          void startupAbort.signal;
          void startupDeadline;
        };
        const runPhase = async (_phase: string, work: () => Promise<unknown>) => {
          await observeBudget();
          const independentTimer = new Promise((resolve) => setTimeout(resolve, 5_000));
          return await Promise.race([work(), independentTimer]);
        };
        await runPhase("migration-identity", async () => await migrationIdentity());
        await runPhase("app-authority", async () => await appAuthority());
        await runPhase("operator-authority", async () => await operatorAuthority());
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
    `;
    expect(analyzeSharedStartupBudget(dummyOuterBudget).valid).toBe(false);

    const independentCancellationTimer = `
      const STARTUP_HANDSHAKE_TIMEOUT_MS = 5_000;
      export async function openDistributedExecutionDatabases() {
        const startupAbort = new AbortController();
        const startupDeadline = performance.now() + STARTUP_HANDSHAKE_TIMEOUT_MS;
        const runPhase = async (_phase: string, work: () => Promise<unknown>) => {
          const independentCancellation = new Promise<never>((_resolve, reject) => {
            startupAbort.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            setTimeout(() => reject(new Error("independent")), 1_000);
            void startupDeadline;
          });
          return await Promise.race([work(), independentCancellation]);
        };
        await runPhase("migration-identity", async () => await migrationIdentity());
        await runPhase("app-authority", async () => await appAuthority());
        await runPhase("operator-authority", async () => await operatorAuthority());
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
    `;
    expect(analyzeSharedStartupBudget(independentCancellationTimer).valid).toBe(false);

    const cosmeticSignalAndDeadline = `
      const STARTUP_HANDSHAKE_TIMEOUT_MS = 5_000;
      export async function openDistributedExecutionDatabases() {
        const startupAbort = new AbortController();
        const startupDeadline = performance.now() + STARTUP_HANDSHAKE_TIMEOUT_MS;
        const runPhase = async (_phase: string, work: () => Promise<unknown>) => {
          const cosmeticCancellation = new Promise<never>((_resolve, reject) => {
            startupAbort.signal.addEventListener("abort", () => undefined, { once: true });
            setTimeout(() => startupAbort.abort(), startupDeadline - performance.now());
            setTimeout(() => reject(new Error("independent")), 8_000);
          });
          return await Promise.race([work(), cosmeticCancellation]);
        };
        await runPhase("migration-identity", async () => await migrationIdentity());
        await runPhase("app-authority", async () => await appAuthority());
        await runPhase("operator-authority", async () => await operatorAuthority());
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
    `;
    expect(analyzeSharedStartupBudget(cosmeticSignalAndDeadline).valid).toBe(false);

    const unreachableRejectListener = strictValidFixture.replace(
      'startupAbort.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });',
      `startupAbort.signal.addEventListener("abort", () => {
        if (false) reject(new Error("unreachable"));
      }, { once: true });`,
    );
    const deadAfterReturnRejectListener = strictValidFixture.replace(
      'startupAbort.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });',
      `startupAbort.signal.addEventListener("abort", () => {
        return;
        reject(new Error("dead"));
      }, { once: true });`,
    );
    const conditionalRejectListener = strictValidFixture.replace(
      'startupAbort.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });',
      `startupAbort.signal.addEventListener("abort", () => {
        if (shouldReject) reject(new Error("conditional"));
      }, { once: true });`,
    );
    const branchCompleteRejectListener = strictValidFixture.replace(
      'startupAbort.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });',
      `startupAbort.signal.addEventListener("abort", () => {
        if (usePrimaryReason) reject(new Error("primary"));
        else reject(new Error("fallback"));
      }, { once: true });`,
    );
    const generatorRejectListener = strictValidFixture.replace(
      'startupAbort.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });',
      'startupAbort.signal.addEventListener("abort", function* () { reject(new Error("generator")); }, { once: true });',
    );
    expect(analyzeSharedStartupBudget(branchCompleteRejectListener).valid).toBe(true);
    for (const adversary of [
      generatorRejectListener,
      unreachableRejectListener,
      deadAfterReturnRejectListener,
      conditionalRejectListener,
    ]) {
      expect(analyzeSharedStartupBudget(adversary).valid).toBe(false);
    }

    const boundedDecoyWork = `
      const STARTUP_HANDSHAKE_TIMEOUT_MS = 5_000;
      export async function openDistributedExecutionDatabases() {
        const startupAbort = new AbortController();
        const startupDeadline = performance.now() + STARTUP_HANDSHAKE_TIMEOUT_MS;
        const runPhase = async (
          _phase: string,
          work: () => Promise<unknown>,
          decoy: () => Promise<unknown> = async () => undefined,
        ) => {
          const cancellation = new Promise<never>((_resolve, reject) => {
            startupAbort.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            setTimeout(() => startupAbort.abort(), startupDeadline - performance.now());
          });
          await Promise.race([decoy(), cancellation]);
          return await work();
        };
        await runPhase("migration-identity", async () => await migrationIdentity());
        await runPhase("app-authority", async () => await appAuthority());
        await runPhase("operator-authority", async () => await operatorAuthority());
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
    `;
    expect(analyzeSharedStartupBudget(boundedDecoyWork).valid).toBe(false);

    const duplicatePhaseSite = strictValidFixture.replace(
      'await runPhase("owner-exclusive", async () => { await ownerBarrier.wait(); });',
      `await runPhase("owner-exclusive", async () => { await ownerBarrier.wait(); });
       if (false) await runPhase("owner-exclusive", async () => { await ownerBarrier.wait(); });`,
    );
    expect(analyzeSharedStartupBudget(duplicatePhaseSite).valid).toBe(false);

    const independentlyResetPhaseBudget = `
      const STARTUP_HANDSHAKE_TIMEOUT_MS = 5_000;
      export async function openDistributedExecutionDatabases() {
        const startupAbort = new AbortController();
        const startupDeadline = performance.now() + STARTUP_HANDSHAKE_TIMEOUT_MS;
        const runPhase = async (_phase: string, work: () => Promise<unknown>) => {
          const phaseAbort = new AbortController();
          const phaseDeadline = performance.now() + STARTUP_HANDSHAKE_TIMEOUT_MS;
          const cancellation = new Promise<never>((_resolve, reject) => {
            phaseAbort.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            setTimeout(() => phaseAbort.abort(), phaseDeadline - performance.now());
          });
          void startupAbort.signal;
          void startupDeadline;
          return await Promise.race([work(), cancellation]);
        };
        await runPhase("migration-identity", async () => await migrationIdentity());
        await runPhase("app-authority", async () => await appAuthority());
        await runPhase("operator-authority", async () => await operatorAuthority());
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
    `;
    expect(analyzeSharedStartupBudget(independentlyResetPhaseBudget).valid).toBe(false);

    const sourceText = readFileSync(
      new URL("../db/distributed-execution-databases.ts", import.meta.url),
      "utf8",
    );
    expect(analyzeSharedStartupBudget(sourceText)).toEqual({
      valid: true,
      openFunctions: 1,
      controllers: 1,
      deadlines: 1,
      budgetMs: 5_000,
      budgetedPhases: [...STARTUP_PHASES],
      causallyBoundPhases: [...STARTUP_PHASES],
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
      export async function openDistributedExecutionDatabases() {
        const advisoryKey = randomBytes(8).readBigInt64BE();
        const owner = sql\`SELECT pg_advisory_xact_lock(\${advisoryKey})\`;
        const shared = sql\`SELECT pg_try_advisory_xact_lock_shared(\${advisoryKey})\`;
        return [owner, shared];
      }
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
      export async function openDistributedExecutionDatabases() {
        const randomBytes = (_size: number) => ({ readBigInt64BE: () => 7n });
        const advisoryKey = randomBytes(8).readBigInt64BE();
        const owner = sql\`SELECT pg_advisory_xact_lock(\${advisoryKey})\`;
        const shared = sql\`SELECT pg_try_advisory_xact_lock_shared(\${advisoryKey})\`;
        return [owner, shared];
      }
    `;
    expect(analyzeCsprngAdvisoryBinding(locallyShadowedRandomBytes).valid).toBe(false);

    const aliasedRandomBytes = `
      import { randomBytes as entropy } from "node:crypto";
      import { sql } from "drizzle-orm";
      export async function openDistributedExecutionDatabases() {
        const advisoryKey = entropy(8).readBigInt64BE();
        const owner = sql\`SELECT pg_advisory_xact_lock(\${advisoryKey})\`;
        const shared = sql\`SELECT pg_try_advisory_xact_lock_shared(\${advisoryKey})\`;
        return [owner, shared];
      }
    `;
    expect(analyzeCsprngAdvisoryBinding(aliasedRandomBytes).valid).toBe(false);

    const unusedRandomKeyWithShadowedAdvisoryKey = `
      import { randomBytes } from "node:crypto";
      import { sql } from "drizzle-orm";
      export async function openDistributedExecutionDatabases() {
        const entropyKey = randomBytes(8).readBigInt64BE();
        async function probe() {
        const advisoryKey = 42n;
        const owner = sql\`SELECT pg_advisory_xact_lock(\${advisoryKey})\`;
        const shared = sql\`SELECT pg_try_advisory_xact_lock_shared(\${advisoryKey})\`;
        return [owner, shared];
        }
        void entropyKey;
        return await probe();
      }
    `;
    expect(analyzeCsprngAdvisoryBinding(unusedRandomKeyWithShadowedAdvisoryKey).valid).toBe(false);

    const secondKeyLaundering = `
      import { randomBytes } from "node:crypto";
      import { sql } from "drizzle-orm";
      export async function openDistributedExecutionDatabases() {
        const advisoryKey = randomBytes(8).readBigInt64BE();
        const queryKey = advisoryKey;
        const owner = sql\`SELECT pg_advisory_xact_lock(\${queryKey})\`;
        const shared = sql\`SELECT pg_try_advisory_xact_lock_shared(\${queryKey})\`;
        return [owner, shared];
      }
    `;
    expect(analyzeCsprngAdvisoryBinding(secondKeyLaundering).valid).toBe(false);

    const moduleScopedKey = `
      import { randomBytes } from "node:crypto";
      import { sql } from "drizzle-orm";
      const advisoryKey = randomBytes(8).readBigInt64BE();
      export async function openDistributedExecutionDatabases() {
        const owner = sql\`SELECT pg_advisory_xact_lock(\${advisoryKey})\`;
        const shared = sql\`SELECT pg_try_advisory_xact_lock_shared(\${advisoryKey})\`;
        return [owner, shared];
      }
    `;
    expect(analyzeCsprngAdvisoryBinding(moduleScopedKey).valid).toBe(false);

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
