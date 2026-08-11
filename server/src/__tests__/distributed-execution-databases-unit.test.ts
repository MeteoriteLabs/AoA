import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
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
  "owner-exclusive",
  "app-negative",
  "operator-negative",
  "app-positive",
  "operator-positive",
] as const;

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
  const controllerDeclarations: ts.VariableDeclaration[] = [];
  const deadlineDeclarations: ts.VariableDeclaration[] = [];
  const deadlineBudgets = new Map<ts.VariableDeclaration, number | null>();
  const deadlineWrites: ts.BinaryExpression[] = [];
  let independentSignalTimeouts = 0;
  const unwrap = (node: ts.Expression): ts.Expression => {
    let current = node;
    while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current)) current = current.expression;
    return current;
  };
  const isPerformanceNow = (node: ts.Node): boolean => {
    const expression = ts.isExpression(node) ? unwrap(node) : node;
    return ts.isCallExpression(expression) && expression.arguments.length === 0 &&
      expression.expression.getText(source) === "performance.now";
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
        node.initializer.expression.getText(source) === "AbortController" &&
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
    if (ts.isCallExpression(node) && node.expression.getText(source) === "AbortSignal.timeout") {
      independentSignalTimeouts += 1;
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
  const deadlineSymbol = perOpenDeadlines.length === 1 &&
    ts.isIdentifier(perOpenDeadlines[0]!.name)
    ? checker.getSymbolAtLocation(perOpenDeadlines[0]!.name)
    : undefined;
  const budgetMs = perOpenDeadlines.length === 1
    ? deadlineBudgets.get(perOpenDeadlines[0]!) ?? null
    : null;
  const isExactSignal = (node: ts.Node) => ts.isPropertyAccessExpression(node) &&
    node.name.text === "signal" && ts.isIdentifier(node.expression) &&
    checker.getSymbolAtLocation(node.expression) === controllerSymbol;
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
        checker.getSymbolAtLocation(candidate.expression.expression) === controllerSymbol) {
        found = true;
      }
      ts.forEachChild(candidate, visit);
    };
    visit(node);
    return found;
  };
  const listenerInvokesReject = (node: ts.Node, rejectSymbol: ts.Symbol): boolean => {
    const expression = ts.isExpression(node) ? unwrap(node) : undefined;
    if (expression && ts.isIdentifier(expression) &&
      checker.getSymbolAtLocation(expression) === rejectSymbol) return true;
    let body: ts.Node = node;
    if (expression && ts.isIdentifier(expression)) {
      const declaration = checker.getSymbolAtLocation(expression)?.valueDeclaration;
      if (declaration && ts.isFunctionDeclaration(declaration) && declaration.body) body = declaration.body;
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer &&
        (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
        body = declaration.initializer.body;
      }
    }
    let found = false;
    const visit = (candidate: ts.Node) => {
      if (ts.isCallExpression(candidate) && ts.isIdentifier(candidate.expression) &&
        checker.getSymbolAtLocation(candidate.expression) === rejectSymbol) found = true;
      ts.forEachChild(candidate, visit);
    };
    visit(body);
    return found;
  };
  const containsRejectingAbortListener = (node: ts.Node, rejectSymbol: ts.Symbol): boolean => {
    let found = false;
    const visit = (candidate: ts.Node) => {
      if (ts.isCallExpression(candidate) &&
        ts.isPropertyAccessExpression(candidate.expression) &&
        candidate.expression.name.text === "addEventListener" &&
        isExactSignal(candidate.expression.expression) &&
        ts.isStringLiteral(candidate.arguments[0]) && candidate.arguments[0].text === "abort" &&
        candidate.arguments[1] !== undefined &&
        listenerInvokesReject(candidate.arguments[1], rejectSymbol)) {
        found = true;
      }
      ts.forEachChild(candidate, visit);
    };
    visit(node);
    return found;
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
  const containsDeadlineAbortTimer = (node: ts.Node): boolean => {
    let found = false;
    const visit = (candidate: ts.Node) => {
      if (ts.isCallExpression(candidate) && candidate.expression.getText(source) === "setTimeout" &&
        candidate.arguments.length >= 2 && containsControllerAbort(candidate.arguments[0]!) &&
        containsDeadlineSubtraction(candidate.arguments[1]!)) {
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
    return rejectSymbol !== undefined && containsRejectingAbortListener(initializer, rejectSymbol) &&
      containsDeadlineAbortTimer(initializer);
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
  return {
    valid: openFunctions.length === 1 && controllerDeclarations.length === 1 &&
      perOpenControllers.length === 1 && deadlineDeclarations.length === 1 &&
      perOpenDeadlines.length === 1 && budgetMs === 5_000 &&
      deadlineWrites.length === 0 && independentSignalTimeouts === 0 &&
      budgetedPhases.length === STARTUP_PHASES.length && negativeConcurrent && positiveConcurrent &&
      requiredBarriers.every((phase) => budgetedBarrierPhases.includes(phase)),
    openFunctions: openFunctions.length,
    controllers: controllerDeclarations.length,
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
      const STARTUP_HANDSHAKE_TIMEOUT_MS = 5_000;
      export async function openDistributedExecutionDatabases() {
        const startupAbort = new AbortController();
        const startupDeadline = performance.now() + STARTUP_HANDSHAKE_TIMEOUT_MS;
        const runPhase = async (_phase: string, work: () => Promise<unknown>) => {
          const cancellation = new Promise<never>((_resolve, reject) => {
            startupAbort.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            setTimeout(
              () => startupAbort.abort(),
              Math.max(0, startupDeadline - performance.now()),
            );
          });
          return await Promise.race([work(), cancellation]);
        };
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
