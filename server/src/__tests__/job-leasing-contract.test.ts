import { describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  OPERATION_DESCRIPTORS,
  pollRequestV1Schema,
  protocolErrorV1Schema,
} from "@armyofagents/worker-protocol";
import { createWorkerSessionToken } from "../middleware/worker-session-auth.js";
import {
  verifyWorkerOperationProof,
  WorkerOperationProofError,
} from "../middleware/worker-operation-proof.js";
import { buildDeviceProofCanonicalInput } from "../services/worker-device-proof.js";
import { workerOperationProtocolErrorV1 } from "../services/worker-protocol-http.js";

type AuthorityWriter = {
  file: string;
  functionName: string;
  table: "executionTargets" | "workers";
  fields: string[];
  mode: "authority" | "last_seen_only";
};

type LexicalTableDeclaration = {
  name: string;
  table: AuthorityWriter["table"] | null;
  start: number;
  scopeStart: number;
  scopeEnd: number;
};

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

function productionTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "migrations" || entry.name === "dist") continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...productionTypeScriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) files.push(path);
  }
  return files;
}

function propertyName(node: ts.PropertyName | undefined): string | null {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return null;
}

function enclosingFunctionName(node: ts.Node): string {
  let current: ts.Node | undefined = node;
  while (current) {
    if ((ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) && current.name) {
      return propertyName(current.name) ?? "<anonymous>";
    }
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const parent = current.parent;
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
      if (ts.isPropertyAssignment(parent)) return propertyName(parent.name) ?? "<anonymous>";
    }
    current = current.parent;
  }
  return "<module>";
}

function canonicalTableName(
  node: ts.Expression | undefined,
  aliases: Map<string, AuthorityWriter["table"]>,
): AuthorityWriter["table"] | null {
  if (!node) return null;
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
    return canonicalTableName(node.expression, aliases);
  }
  if (ts.isPropertyAccessExpression(node) &&
      (node.name.text === "executionTargets" || node.name.text === "workers")) {
    return node.name.text;
  }
  if (!ts.isIdentifier(node)) return null;
  if (node.text === "executionTargets" || node.text === "workers") return node.text;
  return aliases.get(node.text) ?? null;
}

function lexicalTableName(
  node: ts.Expression | undefined,
  useNode: ts.Node,
  declarations: LexicalTableDeclaration[],
  exportedAliases = new Map<string, AuthorityWriter["table"]>(),
): AuthorityWriter["table"] | null {
  if (!node) return null;
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
    return lexicalTableName(node.expression, useNode, declarations, exportedAliases);
  }
  if (ts.isPropertyAccessExpression(node)) {
    if (node.name.text === "executionTargets" || node.name.text === "workers") return node.name.text;
    return exportedAliases.get(node.name.text) ?? null;
  }
  if (!ts.isIdentifier(node)) return null;
  const use = useNode.getStart();
  const visible = declarations.filter((declaration) =>
    declaration.name === node.text && declaration.start <= use &&
    declaration.scopeStart <= use && use <= declaration.scopeEnd)
    .sort((left, right) =>
      (left.scopeEnd - left.scopeStart) - (right.scopeEnd - right.scopeStart) || right.start - left.start);
  if (visible.length > 0) return visible[0]!.table;
  if (node.text === "executionTargets" || node.text === "workers") return node.text;
  return exportedAliases.get(node.text) ?? null;
}

function authorityExportAliases(
  sources: Array<{ file: string; source: string }>,
): Map<string, AuthorityWriter["table"]> {
  const aliases = new Map<string, AuthorityWriter["table"]>([
    ["executionTargets", "executionTargets"],
    ["workers", "workers"],
  ]);
  for (let pass = 0; pass < 4; pass += 1) {
    for (const input of sources) {
      const file = ts.createSourceFile(input.file, input.source, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isExportSpecifier(node)) {
          const local = node.propertyName?.text ?? node.name.text;
          const table = aliases.get(local);
          if (table) aliases.set(node.name.text, table);
        }
        if (ts.isVariableStatement(node) &&
            node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
          for (const declaration of node.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
            const initializer = declaration.initializer;
            const sourceName = ts.isIdentifier(initializer)
              ? initializer.text
              : ts.isPropertyAccessExpression(initializer) ? initializer.name.text : null;
            const table = sourceName ? aliases.get(sourceName) : undefined;
            if (table) aliases.set(declaration.name.text, table);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
  }
  return aliases;
}

function lexicalTableDeclarations(
  sourceFile: ts.SourceFile,
  exportedAliases = new Map<string, AuthorityWriter["table"]>(),
): LexicalTableDeclaration[] {
  const declarations: LexicalTableDeclaration[] = [];
  const scopeOf = (node: ts.Node): ts.Node => {
    let current: ts.Node | undefined = node.parent;
    while (current && !ts.isBlock(current) && !ts.isSourceFile(current) && !ts.isFunctionLike(current)) {
      current = current.parent;
    }
    return current ?? sourceFile;
  };
  const add = (name: string, table: AuthorityWriter["table"] | null, node: ts.Node, scope = scopeOf(node)): void => {
    declarations.push({
      name,
      table,
      start: node.getStart(sourceFile),
      scopeStart: scope.getStart(sourceFile),
      scopeEnd: scope.getEnd(),
    });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportSpecifier(node)) {
      const imported = node.propertyName?.text ?? node.name.text;
      add(node.name.text, exportedAliases.get(imported) ?? null, node, sourceFile);
    }
    if (ts.isExportSpecifier(node)) {
      const imported = node.propertyName?.text ?? node.name.text;
      add(node.name.text, exportedAliases.get(imported) ?? null, node, sourceFile);
    }
    if (ts.isFunctionLike(node)) {
      for (const parameter of node.parameters) {
        if (ts.isIdentifier(parameter.name)) add(parameter.name.text, null, parameter, node);
      }
    }
    if (ts.isVariableDeclaration(node)) {
      if (ts.isIdentifier(node.name)) {
        const table = lexicalTableName(node.initializer, node, declarations, exportedAliases);
        add(node.name.text, table, node);
      } else if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const sourceName = propertyName(element.propertyName) ?? element.name.text;
          add(element.name.text, exportedAliases.get(sourceName) ?? null, element);
        }
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left)) {
      add(node.left.text, lexicalTableName(node.right, node, declarations, exportedAliases), node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return declarations;
}

function expressionObjectFields(
  node: ts.Expression | undefined,
  objects: Map<string, string[]>,
  functionReturns: Map<string, string[]>,
): string[] {
  if (!node) return ["<dynamic>"];
  if (ts.isAwaitExpression(node) || ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
    return expressionObjectFields(node.expression, objects, functionReturns);
  }
  if (ts.isIdentifier(node)) return objects.get(node.text) ?? ["<dynamic>"];
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    return functionReturns.get(node.expression.text) ?? ["<dynamic>"];
  }
  if (ts.isConditionalExpression(node)) {
    return [...new Set([
      ...expressionObjectFields(node.whenTrue, objects, functionReturns),
      ...expressionObjectFields(node.whenFalse, objects, functionReturns),
    ])].sort();
  }
  if (!ts.isObjectLiteralExpression(node)) return ["<dynamic>"];
  const fields: string[] = [];
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      fields.push(...expressionObjectFields(property.expression, objects, functionReturns));
    } else {
      fields.push(propertyName(property.name) ?? "<computed>");
    }
  }
  return [...new Set(fields)].sort();
}

function templateText(node: ts.TaggedTemplateExpression): string {
  if (ts.isNoSubstitutionTemplateLiteral(node.template)) return node.template.text;
  return [node.template.head.text, ...node.template.templateSpans.map((span) => span.literal.text)].join(" ? ");
}

function sqlFieldName(value: string): string {
  return value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function rawSqlAuthorityWriter(
  node: ts.TaggedTemplateExpression,
  resolveTable: (expression: ts.Expression | undefined) => AuthorityWriter["table"] | null =
    (expression) => canonicalTableName(expression, new Map()),
): {
  table: AuthorityWriter["table"];
  fields: string[];
} | null {
  const text = templateText(node);
  const match = /\bUPDATE\s+(?:"?public"?\.)?"?(execution_targets|workers)"?(?:\s+(?:AS\s+)?[a-z][a-z0-9_]*)?\s+SET\s+([\s\S]*?)(?:\bWHERE\b|\bRETURNING\b|$)/i.exec(text);
  let table = match?.[1]?.toLowerCase() === "execution_targets"
    ? "executionTargets" as const
    : match?.[1]?.toLowerCase() === "workers" ? "workers" as const : null;
  let assignments = match?.[2] ?? "";
  if (!table && /^\s*UPDATE\s+\?/i.test(text) && ts.isTemplateExpression(node.template)) {
    table = resolveTable(node.template.templateSpans[0]?.expression);
    assignments = text.replace(/^\s*UPDATE\s+\?\s+(?:AS\s+\w+\s+)?SET\s+/i, "");
  }
  if (!table) return null;
  const fields = [...assignments.matchAll(/"?([a-z][a-z0-9_]*)"?\s*=/gi)]
    .map((field) => sqlFieldName(field[1]!.toLowerCase()))
    .sort();
  return {
    table,
    fields: fields.length > 0 ? fields : ["<dynamic>"],
  };
}

function rawSqlAuthorityWriterText(text: string): {
  table: AuthorityWriter["table"];
  fields: string[];
} | null {
  const match = /\bUPDATE\s+(?:"?public"?\.)?"?(execution_targets|workers)"?(?:\s+(?:AS\s+)?[a-z][a-z0-9_]*)?\s+SET\s+([\s\S]*?)(?:\bWHERE\b|\bRETURNING\b|$)/i.exec(text);
  if (!match) return null;
  const fields = [...match[2]!.matchAll(/"?([a-z][a-z0-9_]*)"?\s*=/gi)]
    .map((field) => sqlFieldName(field[1]!.toLowerCase()))
    .sort();
  return {
    table: match[1]!.toLowerCase() === "execution_targets" ? "executionTargets" : "workers",
    fields: fields.length > 0 ? fields : ["<dynamic>"],
  };
}

function scanAuthorityWriters(sources: Array<{ file: string; source: string }>): AuthorityWriter[] {
  const writers: AuthorityWriter[] = [];
  const exportedAliases = authorityExportAliases(sources);
  for (const input of sources) {
    const sourceFile = ts.createSourceFile(input.file, input.source, ts.ScriptTarget.Latest, true);
    const lexicalDeclarations = lexicalTableDeclarations(sourceFile, exportedAliases);
    const objectFields = new Map<string, string[]>();
    const expressionAliases = new Map<string, ts.Expression>();
    const functionReturnFields = new Map<string, string[]>();
    const collectFunctionReturns = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        const returned: string[] = [];
        const scanReturns = (child: ts.Node): void => {
          if (child !== node && ts.isFunctionLike(child)) return;
          if (ts.isReturnStatement(child) && child.expression) {
            returned.push(...expressionObjectFields(child.expression, objectFields, functionReturnFields));
          }
          ts.forEachChild(child, scanReturns);
        };
        scanReturns(node.body);
        if (returned.length > 0) functionReturnFields.set(node.name.text, [...new Set(returned)].sort());
      }
      ts.forEachChild(node, collectFunctionReturns);
    };
    collectFunctionReturns(sourceFile);
    for (let pass = 0; pass < 3; pass += 1) {
      const collectObjects = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
          expressionAliases.set(node.name.text, node.initializer);
          const fields = expressionObjectFields(node.initializer, objectFields, functionReturnFields);
          if (fields.some((field) => field !== "<dynamic>")) objectFields.set(node.name.text, fields);
        }
        ts.forEachChild(node, collectObjects);
      };
      collectObjects(sourceFile);
    }
    const conflictSetFields = (node: ts.Expression | undefined, seen = new Set<string>()): string[] => {
      if (!node) return ["<dynamic>"];
      if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
        return conflictSetFields(node.expression, seen);
      }
      if (ts.isIdentifier(node)) {
        if (seen.has(node.text)) return ["<dynamic>"];
        const alias = expressionAliases.get(node.text);
        return alias ? conflictSetFields(alias, new Set([...seen, node.text])) : ["<dynamic>"];
      }
      if (!ts.isObjectLiteralExpression(node)) return ["<dynamic>"];
      const fields: string[] = [];
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property) && propertyName(property.name) === "set") {
          fields.push(...expressionObjectFields(property.initializer, objectFields, functionReturnFields));
        } else if (ts.isShorthandPropertyAssignment(property) && property.name.text === "set") {
          fields.push(...expressionObjectFields(property.name, objectFields, functionReturnFields));
        } else if (ts.isSpreadAssignment(property)) {
          fields.push(...conflictSetFields(property.expression, seen));
        }
      }
      return fields.length > 0 ? [...new Set(fields)].sort() : ["<dynamic>"];
    };
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "set") {
        const update = node.expression.expression;
        if (ts.isCallExpression(update) && ts.isPropertyAccessExpression(update.expression) &&
            update.expression.name.text === "update") {
          const table = lexicalTableName(update.arguments[0], node, lexicalDeclarations, exportedAliases);
          if (table === "executionTargets" || table === "workers") {
            const value = node.arguments[0];
            const fields = expressionObjectFields(value, objectFields, functionReturnFields);
            const lastSeenOnly = fields.every((field) => field === "lastSeenAt" || field === "updatedAt");
            writers.push({
              file: input.file.replaceAll("\\", "/"),
              functionName: enclosingFunctionName(node),
              table,
              fields,
              mode: lastSeenOnly ? "last_seen_only" : "authority",
            });
          }
        }
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          (node.expression.name.text === "unsafe" || node.expression.name.text === "raw")) {
        const argument = node.arguments[0];
        const text = argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
          ? argument.text
          : null;
        const raw = text ? rawSqlAuthorityWriterText(text) : null;
        if (raw) {
          const lastSeenOnly = raw.fields.every((field) => field === "lastSeenAt" || field === "updatedAt");
          writers.push({
            file: input.file.replaceAll("\\", "/"),
            functionName: enclosingFunctionName(node),
            table: raw.table,
            fields: raw.fields,
            mode: lastSeenOnly ? "last_seen_only" : "authority",
          });
        }
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "onConflictDoUpdate" && node.arguments[0]) {
        let chain: ts.Expression = node.expression.expression;
        let table: AuthorityWriter["table"] | null = null;
        while (ts.isCallExpression(chain) && ts.isPropertyAccessExpression(chain.expression)) {
          if (chain.expression.name.text === "insert") {
            table = lexicalTableName(chain.arguments[0], node, lexicalDeclarations, exportedAliases);
            break;
          }
          chain = chain.expression.expression;
        }
        if (table) {
          const fields = conflictSetFields(node.arguments[0]);
          const lastSeenOnly = fields.every((field) => field === "lastSeenAt" || field === "updatedAt");
          writers.push({
            file: input.file.replaceAll("\\", "/"),
            functionName: enclosingFunctionName(node),
            table,
            fields,
            mode: lastSeenOnly ? "last_seen_only" : "authority",
          });
        }
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "delete") {
        const table = lexicalTableName(node.arguments[0], node, lexicalDeclarations, exportedAliases);
        if (table) {
          writers.push({
            file: input.file.replaceAll("\\", "/"),
            functionName: enclosingFunctionName(node),
            table,
            fields: ["<delete>"],
            mode: "authority",
          });
        }
      }
      if (ts.isTaggedTemplateExpression(node)) {
        const raw = rawSqlAuthorityWriter(
          node,
          (expression) => lexicalTableName(expression, node, lexicalDeclarations, exportedAliases),
        );
        if (raw) {
          const lastSeenOnly = raw.fields.every((field) => field === "lastSeenAt" || field === "updatedAt");
          writers.push({
            file: input.file.replaceAll("\\", "/"),
            functionName: enclosingFunctionName(node),
            table: raw.table,
            fields: raw.fields,
            mode: lastSeenOnly ? "last_seen_only" : "authority",
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return writers.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function scanDynamicRawSqlSites(sources: Array<{ file: string; source: string }>): string[] {
  const sites: string[] = [];
  for (const input of sources) {
    const sourceFile = ts.createSourceFile(input.file, input.source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          (node.expression.name.text === "unsafe" || node.expression.name.text === "raw")) {
        const argument = node.arguments[0];
        if (!argument || (!ts.isStringLiteral(argument) && !ts.isNoSubstitutionTemplateLiteral(argument))) {
          const argumentShape = argument?.getText(sourceFile).replace(/\s+/g, " ") ?? "<missing>";
          const argumentDigest = createHash("sha256").update(argumentShape).digest("hex").slice(0, 12);
          sites.push(
            `${input.file.replaceAll("\\", "/")}#${enclosingFunctionName(node)}:.${node.expression.name.text}:${argumentDigest}`,
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return sites.sort();
}

function writerIdentity(writer: AuthorityWriter): string {
  return `${writer.file}#${writer.functionName}:${writer.table}:${writer.fields.join(",")}:${writer.mode}`;
}

function namedFunctionSource(source: string, name: string): string {
  const file = ts.createSourceFile("named-source.ts", source, ts.ScriptTarget.Latest, true);
  let match: string | null = null;
  const visit = (node: ts.Node): void => {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
        propertyName(node.name) === name) {
      match = ts.isMethodDeclaration(node)
        ? `const fixture = { ${node.getText(file)} };`
        : node.getText(file);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!match) throw new Error(`writer function ${name} was not found`);
  return match;
}

function namedFunctionAuditSource(source: string, name: string): string {
  const file = ts.createSourceFile("audit-source.ts", source, ts.ScriptTarget.Latest, true);
  const imports = file.statements
    .filter(ts.isImportDeclaration)
    .map((statement) => statement.getText(file));
  return `${imports.join("\n")}\n${namedFunctionSource(source, name)}`;
}

function forbiddenLeaseContinuationIdentifiers(source: string): string[] {
  const file = ts.createSourceFile("lease-continuation.ts", source, ts.ScriptTarget.Latest, true);
  const forbidden = new Set(["LeaseCandidateCursor", "after", "continuation", "candidateCursor", "leaseScanCursor"]);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && forbidden.has(node.text)) found.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...new Set(found)].sort();
}

function namedInterfaceMethodSource(source: string, interfaceName: string, methodName: string): string {
  const file = ts.createSourceFile("interface-method.ts", source, ts.ScriptTarget.Latest, true);
  let found: string | null = null;
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      const member = node.members.find((candidate) =>
        (ts.isMethodSignature(candidate) || ts.isPropertySignature(candidate)) &&
        propertyName(candidate.name) === methodName);
      if (member) found = member.getText(file);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!found) throw new Error(`${interfaceName}.${methodName} interface method was not found`);
  return found;
}

function namedInterfaceMethodInputMembers(
  source: string,
  interfaceName: string,
  methodName: string,
): string[] {
  const file = ts.createSourceFile("interface-input.ts", source, ts.ScriptTarget.Latest, true);
  let members: string[] | null = null;
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      const method = node.members.find((candidate) =>
        ts.isMethodSignature(candidate) && propertyName(candidate.name) === methodName);
      const parameter = method && ts.isMethodSignature(method) ? method.parameters[0] : undefined;
      if (!parameter?.type || !ts.isTypeLiteralNode(parameter.type)) {
        members = ["<non-literal-input>"];
        return;
      }
      members = parameter.type.members.map((member) => propertyName(member.name) ?? "<dynamic>").sort();
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!members) throw new Error(`${interfaceName}.${methodName} literal input was not found`);
  return members;
}

function namedFunctionInputProperties(source: string, functionName: string, parameterName: string): string[] {
  const file = ts.createSourceFile("function-input.ts", source, ts.ScriptTarget.Latest, true);
  const properties: string[] = [];
  let found = false;
  const visit = (node: ts.Node): void => {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
        propertyName(node.name) === functionName && node.body) {
      found = true;
      const scan = (child: ts.Node): void => {
        if (child !== node.body && ts.isFunctionLike(child)) return;
        if (ts.isPropertyAccessExpression(child) && ts.isIdentifier(child.expression) &&
            child.expression.text === parameterName) {
          properties.push(child.name.text);
        }
        if (ts.isElementAccessExpression(child) && ts.isIdentifier(child.expression) &&
            child.expression.text === parameterName) {
          properties.push(ts.isStringLiteral(child.argumentExpression)
            ? child.argumentExpression.text
            : "<dynamic>");
        }
        ts.forEachChild(child, scan);
      };
      scan(node.body);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!found) throw new Error(`function ${functionName} was not found`);
  return [...new Set(properties)].sort();
}

function namedFunctionMainWhereConjuncts(source: string, functionName: string): string[] {
  const file = ts.createSourceFile("where-contract.ts", source, ts.ScriptTarget.Latest, true);
  let conjuncts: ts.Expression[] | null = null;
  const visit = (node: ts.Node): void => {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
        propertyName(node.name) === functionName && node.body) {
      const scan = (child: ts.Node): void => {
        if (child !== node.body && ts.isFunctionLike(child)) return;
        if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression) &&
            child.expression.name.text === "where" && child.arguments[0] &&
            ts.isCallExpression(child.arguments[0]) && ts.isIdentifier(child.arguments[0].expression) &&
            child.arguments[0].expression.text === "and") {
          const candidates = [...child.arguments[0].arguments];
          const text = candidates.map((candidate) => candidate.getText(file)).join("\n");
          if (text.includes("jobAttempts.status") && text.includes("notExists")) conjuncts = candidates;
        }
        ts.forEachChild(child, scan);
      };
      scan(node.body);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!conjuncts) return ["<main-candidate-where-missing>"];
  return conjuncts.map((expression) => {
    if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) &&
        expression.expression.text === "notExists") {
      const text = expression.getText(file);
      return text.includes("workerLeaseRejections")
        ? "notExists(workerLeaseRejections)"
        : "notExists(<unexpected>)";
    }
    return expression.getText(file)
      .replace(/\s+/g, "")
      .replace(/'([^']*)'/g, '"$1"');
  }).sort();
}

function platformGuardOrderViolations(
  source: string,
  auditAllMutations = false,
  allowReviewedThisDelegate = false,
): string[] {
  const file = ts.createSourceFile("guard-fixture.ts", source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  const lexicalDeclarations = lexicalTableDeclarations(file);
  type HelperKind = "exclusive" | "operatorFactory" | null;
  const helperDeclarations: Array<{
    name: string;
    kind: HelperKind;
    start: number;
    scopeStart: number;
    scopeEnd: number;
  }> = [];
  const helperScopeOf = (node: ts.Node): ts.Node => {
    let current: ts.Node | undefined = node.parent;
    while (current && !ts.isBlock(current) && !ts.isSourceFile(current) && !ts.isFunctionLike(current)) {
      current = current.parent;
    }
    return current ?? file;
  };
  const addHelper = (name: string, kind: HelperKind, node: ts.Node, scope = helperScopeOf(node)): void => {
    helperDeclarations.push({
      name,
      kind,
      start: node.getStart(file),
      scopeStart: scope.getStart(file),
      scopeEnd: scope.getEnd(),
    });
  };
  const collectHelpers = (node: ts.Node): void => {
    if (ts.isImportSpecifier(node)) {
      const imported = node.propertyName?.text ?? node.name.text;
      const declaration = node.parent.parent.parent;
      const moduleName = ts.isImportDeclaration(declaration) && ts.isStringLiteral(declaration.moduleSpecifier)
        ? declaration.moduleSpecifier.text
        : "";
      const allowedModule = moduleName === "@armyofagents/db" ||
        moduleName === "../../platform-target-authority-lock.js";
      addHelper(node.name.text,
        allowedModule && imported === "acquirePlatformTargetAuthorityExclusive"
          ? "exclusive"
          : allowedModule && imported === "operatorJobLeasingRepository"
            ? "operatorFactory"
            : null,
        node,
        file);
    }
    if (ts.isFunctionLike(node)) {
      for (const parameter of node.parameters) {
        if (ts.isIdentifier(parameter.name)) addHelper(parameter.name.text, null, parameter, node);
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) addHelper(node.name.text, null, node);
    if (ts.isFunctionDeclaration(node) && node.name) addHelper(node.name.text, null, node);
    ts.forEachChild(node, collectHelpers);
  };
  collectHelpers(file);
  const helperKindAt = (name: string, useNode: ts.Node): HelperKind => {
    const use = useNode.getStart(file);
    const visible = helperDeclarations.filter((declaration) => declaration.name === name &&
      declaration.start <= use && declaration.scopeStart <= use && use <= declaration.scopeEnd)
      .sort((left, right) =>
        (left.scopeEnd - left.scopeStart) - (right.scopeEnd - right.scopeStart) || right.start - left.start);
    return visible[0]?.kind ?? null;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && node.body) {
      const markers: Array<{
        kind: "target" | "worker" | "combined" | "exclusive" | "mutation";
        position: number;
        controlPath: string[];
      }> = [];
      const controlPath = (child: ts.Node): string[] => {
        const path: string[] = [];
        let current: ts.Node | undefined = child;
        while (current && current !== node) {
          const parent = current.parent;
          if (!parent) break;
          if (ts.isIfStatement(parent)) {
            path.unshift(`${parent.getStart(file)}:${current === parent.thenStatement ? "then" : "else"}`);
          } else if (ts.isTryStatement(parent)) {
            path.unshift(`${parent.getStart(file)}:${current === parent.tryBlock ? "try" :
              current === parent.catchClause ? "catch" : "finally"}`);
          } else if (ts.isConditionalExpression(parent)) {
            path.unshift(`${parent.getStart(file)}:${current === parent.whenTrue ? "true" : "false"}`);
          } else if (ts.isCaseClause(parent) || ts.isDefaultClause(parent) ||
              ts.isForStatement(parent) || ts.isForInStatement(parent) || ts.isForOfStatement(parent) ||
              ts.isWhileStatement(parent) || ts.isDoStatement(parent) || ts.isCatchClause(parent)) {
            path.unshift(`${parent.kind}:${parent.getStart(file)}`);
          }
          current = parent;
        }
        return path;
      };
      const addMarker = (
        kind: (typeof markers)[number]["kind"],
        child: ts.Node,
      ): void => {
        markers.push({ kind, position: child.getStart(file), controlPath: controlPath(child) });
      };
      const scan = (child: ts.Node): void => {
        if (child !== node.body && ts.isFunctionLike(child)) return;
        if (ts.isCallExpression(child)) {
          const callName = ts.isIdentifier(child.expression)
            ? child.expression.text
            : ts.isPropertyAccessExpression(child.expression)
              ? child.expression.name.text
              : null;
          if (callName === "for" && child.arguments[0] && ts.isStringLiteral(child.arguments[0]) &&
              child.arguments[0].text === "update" && ts.isPropertyAccessExpression(child.expression)) {
            let query: ts.Expression = child.expression.expression;
            let fromArgument: ts.Expression | undefined;
            while (ts.isCallExpression(query) && ts.isPropertyAccessExpression(query.expression)) {
              if (query.expression.name.text === "from") {
                fromArgument = query.arguments[0];
                break;
              }
              query = query.expression.expression;
            }
            const lockedTable = lexicalTableName(fromArgument, child, lexicalDeclarations);
            if (lockedTable === "executionTargets") {
              addMarker("target", child);
            }
            if (lockedTable === "workers") {
              addMarker("worker", child);
            }
          }
          if (ts.isIdentifier(child.expression) &&
              helperKindAt(child.expression.text, child) === "exclusive") {
            addMarker("exclusive", child);
          }
          if (ts.isPropertyAccessExpression(child.expression) &&
              child.expression.name.text === "lockPlatformAuthorityForMutation") {
            const receiver = child.expression.expression;
            const trustedThis = allowReviewedThisDelegate && receiver.kind === ts.SyntaxKind.ThisKeyword;
            const trustedFactory = ts.isCallExpression(receiver) && ts.isIdentifier(receiver.expression) &&
              helperKindAt(receiver.expression.text, child) === "operatorFactory";
            if (trustedThis || trustedFactory) addMarker("combined", child);
          }
          if (callName === "set" && ts.isPropertyAccessExpression(child.expression)) {
            const update = child.expression.expression;
            if (ts.isCallExpression(update) && ts.isPropertyAccessExpression(update.expression) &&
                update.expression.name.text === "update" &&
                (auditAllMutations || lexicalTableName(update.arguments[0], child, lexicalDeclarations) !== null)) {
              addMarker("mutation", child);
            }
          }
          if (callName === "onConflictDoUpdate" && ts.isPropertyAccessExpression(child.expression)) {
            let chain: ts.Expression = child.expression.expression;
            while (ts.isCallExpression(chain) && ts.isPropertyAccessExpression(chain.expression)) {
              if (chain.expression.name.text === "insert" && (auditAllMutations ||
                  lexicalTableName(chain.arguments[0], child, lexicalDeclarations) !== null)) {
                addMarker("mutation", child);
                break;
              }
              chain = chain.expression.expression;
            }
          }
          if (callName === "delete" && ts.isPropertyAccessExpression(child.expression) &&
              (auditAllMutations || lexicalTableName(child.arguments[0], child, lexicalDeclarations) !== null)) {
            addMarker("mutation", child);
          }
          if ((callName === "unsafe" || callName === "raw") && child.arguments[0]) {
            const argument = child.arguments[0];
            const rawText = ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)
              ? argument.text
              : "";
            if (/\bSELECT\b[\s\S]*?\bFROM\s+(?:"?public"?\.)?"?execution_targets"?[\s\S]*?\bFOR\s+UPDATE\b/i.test(rawText)) {
              addMarker("target", child);
            }
            if (/\bSELECT\b[\s\S]*?\bFROM\s+(?:"?public"?\.)?"?workers"?[\s\S]*?\bFOR\s+UPDATE\b/i.test(rawText)) {
              addMarker("worker", child);
            }
            if (rawSqlAuthorityWriterText(rawText) || auditAllMutations && /\b(?:UPDATE|DELETE)\b/i.test(rawText)) {
              addMarker("mutation", child);
            }
          }
        }
        if (ts.isTaggedTemplateExpression(child)) {
          const rawText = templateText(child);
          if (/\bSELECT\b[\s\S]*?\bFROM\s+"?execution_targets"?[\s\S]*?\bFOR\s+UPDATE\b/i.test(rawText)) {
            addMarker("target", child);
          }
          if (/\bSELECT\b[\s\S]*?\bFROM\s+"?workers"?[\s\S]*?\bFOR\s+UPDATE\b/i.test(rawText)) {
            addMarker("worker", child);
          }
          if (rawSqlAuthorityWriter(
            child,
            (expression) => lexicalTableName(expression, child, lexicalDeclarations),
          ) || auditAllMutations && /\b(?:UPDATE|DELETE)\b/i.test(rawText)) {
            addMarker("mutation", child);
          }
        }
        ts.forEachChild(child, scan);
      };
      scan(node.body);
      const dominates = (guard: (typeof markers)[number], mutation: (typeof markers)[number]): boolean =>
        guard.position < mutation.position && guard.controlPath.every((part, index) => mutation.controlPath[index] === part);
      const mutations = markers.filter((marker) => marker.kind === "mutation");
      if (mutations.length > 0) {
        for (const mutation of mutations) {
          const targets = markers.filter((marker) => marker.kind === "target" && dominates(marker, mutation));
          const workers = markers.filter((marker) => marker.kind === "worker" && dominates(marker, mutation));
          const exclusives = markers.filter((marker) => marker.kind === "exclusive" && dominates(marker, mutation));
          const combined = markers.filter((marker) => marker.kind === "combined" && dominates(marker, mutation));
          const directOrder = targets.some((target) => workers.some((worker) =>
            target.position < worker.position && exclusives.some((exclusive) =>
              worker.position < exclusive.position && exclusive.position < mutation.position)));
          // A delegated writer may call the single reviewed helper. The helper
          // itself is audited below and must contain target -> worker ->
          // exclusive; a call bearing this name is never enough on its own.
          const delegatedOrder = combined.some((guard) => dominates(guard, mutation));
          if (directOrder || delegatedOrder) continue;
          violations.push(enclosingFunctionName(node));
          break;
        }
      } else if (enclosingFunctionName(node) === "lockPlatformAuthorityForMutation") {
        const targets = markers.filter((marker) => marker.kind === "target");
        const workers = markers.filter((marker) => marker.kind === "worker");
        const exclusives = markers.filter((marker) => marker.kind === "exclusive");
        const completePath = targets.some((target) => workers.some((worker) =>
          dominates(target, worker) && exclusives.some((exclusive) => dominates(worker, exclusive))));
        if (!completePath) violations.push("lockPlatformAuthorityForMutation");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...new Set(violations)].sort();
}

function signedPoll() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyBytes = publicKey.export({ format: "der", type: "spki" });
  const publicKeyHeader = publicKeyBytes.toString("base64url");
  const deviceThumbprint = createHash("sha256").update(publicKeyBytes).digest("hex");
  const now = new Date();
  const request = pollRequestV1Schema.parse({
    protocolVersion: 1,
    correlationId: randomUUID(),
    issuedAt: now.toISOString(),
    nonce: "job-003-contract-poll",
    audience: "worker_poll",
    workerId: "b3000000-0000-4000-8000-000000000001",
    targetId: "b3000000-0000-4000-8000-000000000002",
    deviceGeneration: 3,
    capacity: {
      batchSlots: 1,
      browserSessionSlots: 0,
      serviceSlots: 0,
      freeCpuMillis: 1_000,
      freeMemoryMiB: 1_024,
      freeDiskMiB: 2_048,
    },
  });
  const rawBody = Buffer.from(JSON.stringify(request));
  const proofId = "job-003-contract-proof";
  const canonical = buildDeviceProofCanonicalInput({
    method: "POST",
    path: "/api/worker-control/poll",
    bodyDigest: createHash("sha256").update(rawBody).digest("hex"),
    correlationId: request.correlationId,
    issuedAt: now.toISOString(),
    proofId,
  });
  const sessionKey = "job-003-contract-session-signing-key-which-is-long-enough";
  return {
    now,
    request,
    rawBody,
    authorization: `Bearer ${createWorkerSessionToken(sessionKey, {
      aud: "device_session",
      sub: request.workerId,
      organizationId: "b3000000-0000-4000-8000-000000000003",
      targetId: request.targetId,
      generation: 3,
      scope: "organization",
      deviceThumbprint,
      profileHash: "9".repeat(64),
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor((now.getTime() + 10 * 60_000) / 1000),
    })}`,
    sessionKey,
    deviceThumbprint,
    proof: {
      version: "1",
      publicKey: publicKeyHeader,
      signature: sign(null, Buffer.from(canonical), privateKey).toString("base64url"),
      issuedAt: now.toISOString(),
      proofId,
    },
  };
}

describe("JOB-003 frozen worker-operation HTTP contract", () => {
  it("verifies the session and Ed25519 proof without opening a database transaction", () => {
    const signed = signedPoll();
    const verified = verifyWorkerOperationProof({
      sessionSigningKey: signed.sessionKey,
      authorization: signed.authorization,
      rawBody: signed.rawBody,
      proof: signed.proof,
      method: "POST",
      path: "/api/worker-control/poll",
      correlationId: signed.request.correlationId,
      now: signed.now,
    });
    expect(verified).toMatchObject({
      organizationId: "b3000000-0000-4000-8000-000000000003",
      workerId: signed.request.workerId,
      targetId: signed.request.targetId,
      targetGeneration: 3,
      profileHash: "9".repeat(64),
      proofId: "job-003-contract-proof",
    });
    expect(Object.keys(verified)).not.toContain("fenceToken");
  });

  it("binds proof to method/path/body/correlation and denies a copied bearer token", () => {
    const signed = signedPoll();
    const base = {
      sessionSigningKey: signed.sessionKey,
      authorization: signed.authorization,
      rawBody: signed.rawBody,
      proof: signed.proof,
      method: "POST",
      path: "/api/worker-control/poll",
      correlationId: signed.request.correlationId,
      now: signed.now,
    };
    expect(() => verifyWorkerOperationProof({ ...base, method: "PUT" })).toThrow(WorkerOperationProofError);
    expect(() => verifyWorkerOperationProof({ ...base, path: "/api/worker-control/lease-ack" })).toThrow(WorkerOperationProofError);
    expect(() => verifyWorkerOperationProof({ ...base, rawBody: Buffer.from("{}") })).toThrow(WorkerOperationProofError);
    expect(() => verifyWorkerOperationProof({
      ...base,
      proof: { ...signed.proof, signature: "copied-session-without-device-key" },
    })).toThrow(WorkerOperationProofError);
  });

  it("rejects the platform-scoped physical session before any tenant lookup", () => {
    const signed = signedPoll();
    const platformAuthorization = `Bearer ${createWorkerSessionToken(signed.sessionKey, {
      aud: "device_session",
      sub: signed.request.workerId,
      organizationId: null,
      targetId: signed.request.targetId,
      generation: 3,
      scope: "platform",
      deviceThumbprint: signed.deviceThumbprint,
      profileHash: "9".repeat(64),
      iat: Math.floor(signed.now.getTime() / 1000),
      exp: Math.floor((signed.now.getTime() + 10 * 60_000) / 1000),
    })}`;
    expect(() => verifyWorkerOperationProof({
      sessionSigningKey: signed.sessionKey,
      authorization: platformAuthorization,
      rawBody: signed.rawBody,
      proof: signed.proof,
      method: "POST",
      path: "/api/worker-control/poll",
      correlationId: signed.request.correlationId,
      now: signed.now,
    })).toThrow(WorkerOperationProofError);
  });

  it("uses only descriptor-allowed frozen poll errors with redacted detail", () => {
    const request = {
      body: { correlationId: randomUUID() },
      header: () => undefined,
    } as never;
    for (const code of OPERATION_DESCRIPTORS.poll.errors) {
      const error = workerOperationProtocolErrorV1(request, "poll", code, new Date());
      expect(protocolErrorV1Schema.parse(error)).toEqual(error);
      expect(error.detail).toEqual({});
      expect(error.redaction).toBe("secret");
    }
  });

  it("keeps worker routes behind the default-off distributed execution composition", () => {
    const source = readFileSync(new URL("../app.ts", import.meta.url), "utf8");
    const flagBlock = source.slice(
      source.indexOf("if (opts.distributedExecutionEnabled)"),
      source.indexOf("// Settings -> Providers"),
    );
    expect(flagBlock).toContain("workerControlRoutes");
    expect(flagBlock).toContain("tenantAppDb");
    expect(flagBlock).toContain("operatorDb");
    expect(flagBlock).toContain("workerSessionSigningKey");
    expect(flagBlock).toContain("owner fallback is forbidden");
    expect(flagBlock).not.toContain("appDb: db");
  });

  it("enforces an exhaustive authority-writer allowlist and target-worker-exclusive lock order", () => {
    const dbHelper = new URL("../../../packages/db/src/platform-target-authority-lock.ts", import.meta.url);
    expect(existsSync(dbHelper), "platform-target lock helper must exist before writers can be guarded").toBe(true);
    const sourceFiles = [
      ...productionTypeScriptFiles(join(repositoryRoot, "server", "src")),
      ...productionTypeScriptFiles(join(repositoryRoot, "packages", "db", "src")),
    ].map((path) => ({
      file: relative(repositoryRoot, path).replaceAll("\\", "/"),
      source: readFileSync(path, "utf8"),
    }));
    const authorityWriters = scanAuthorityWriters(sourceFiles);
    const inventory = authorityWriters.map(writerIdentity);
    const dynamicRawSqlSites = scanDynamicRawSqlSites(sourceFiles);
    const expected = [
      "packages/db/src/repositories/tenant/job-control.ts#touchWorkerLeaseProfile:workers:lastSeenAt,updatedAt:last_seen_only",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#advanceTargetGeneration:executionTargets:deviceGeneration,updatedAt:authority",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#heartbeatPlatformPhysicalLivenessOnly:executionTargets:lastSeenAt,updatedAt:last_seen_only",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#heartbeatPlatformPhysicalLivenessOnly:workers:lastSeenAt,updatedAt:last_seen_only",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#heartbeatSessionProfile:workers:lastSeenAt,updatedAt:last_seen_only",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#heartbeatSessionTarget:executionTargets:lastSeenAt,updatedAt:last_seen_only",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#heartbeatSharedPlatformTarget:executionTargets:lastSeenAt,updatedAt:last_seen_only",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#heartbeatSharedPlatformTarget:workers:lastSeenAt,updatedAt:last_seen_only",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#ratifyPlacementProfile:executionTargets:providerConstraintProfile,registeredProfile,registeredProfileHash,updatedAt:authority",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#retireBootstrapCredential:executionTargets:updatedAt,workerTokenHash:authority",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#revokeTargetAuthority:executionTargets:deviceGeneration,status,updatedAt,workerTokenHash:authority",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#revokeTargetAuthority:workers:revokedAt,status,updatedAt:authority",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#rotateWorker:workers:deviceGeneration,devicePublicKey,deviceThumbprint,enrolledAt,profileHash,profileSnapshot,revokedAt,status,updatedAt:authority",
      "server/src/services/execution-targets.ts#ratifyPlatformExecutionTargetPlacementProfile:executionTargets:providerConstraintProfile,registeredProfile,registeredProfileHash,updatedAt:authority",
      "server/src/services/execution-targets.ts#registerWorkerHeartbeat:executionTargets:capabilities,lastSeenAt,status,updatedAt:authority",
      "server/src/services/execution-targets.ts#revokeExecutionTargetWorkerToken:executionTargets:status,updatedAt,workerTokenHash:authority",
      "server/src/services/execution-targets.ts#rotateExecutionTargetWorkerToken:executionTargets:updatedAt,workerTokenHash:authority",
    ].sort();
    expect.soft(inventory).toEqual(expected);
    expect.soft(inventory.some((identity) => /<(?:dynamic|computed|spread)>/.test(identity))).toBe(false);
    expect.soft(inventory.filter((identity) => identity.includes("#heartbeatSessionTarget:"))).toEqual([
      "packages/db/src/repositories/tenant/worker-enrollment.ts#heartbeatSessionTarget:executionTargets:lastSeenAt,updatedAt:last_seen_only",
    ]);
    expect.soft(dynamicRawSqlSites).toEqual([
      "packages/db/src/backup-lib.ts#runDatabaseBackup:.unsafe:072365d746d7",
      "packages/db/src/backup-lib.ts#runDatabaseBackup:.unsafe:1a3a09674d60",
      "packages/db/src/backup-lib.ts#runDatabaseBackup:.unsafe:1b4f79e16771",
      "packages/db/src/backup-lib.ts#runDatabaseBackup:.unsafe:23c6bcd5053a",
      "packages/db/src/backup-lib.ts#runDatabaseBackup:.unsafe:3750173f79dd",
      "packages/db/src/backup-lib.ts#runDatabaseBackup:.unsafe:3750173f79dd",
      "packages/db/src/backup-lib.ts#runDatabaseBackup:.unsafe:449ea6fe0706",
      "packages/db/src/backup-lib.ts#runDatabaseBackup:.unsafe:5cf9416d39b4",
      "packages/db/src/backup-lib.ts#runDatabaseBackup:.unsafe:9466a8f59f88",
      "packages/db/src/backup-lib.ts#runDatabaseBackup:.unsafe:b40423ff6671",
      "packages/db/src/backup-lib.ts#runDatabaseRestore:.unsafe:b111c6e1d318",
      "packages/db/src/client.ts#applyPendingMigrationsManually:.unsafe:b111c6e1d318",
      "packages/db/src/client.ts#ensureMigrationJournalTable:.unsafe:36625b5007ab",
      "packages/db/src/client.ts#ensureMigrationJournalTable:.unsafe:72ea4f2f1e05",
      "packages/db/src/client.ts#ensurePostgresDatabase:.unsafe:22f3c71744a5",
      "packages/db/src/client.ts#getMigrationTableColumnNames:.unsafe:c6ac6fc777f9",
      "packages/db/src/client.ts#latestMigrationCreatedAt:.unsafe:10d48ff08468",
      "packages/db/src/client.ts#loadAppliedMigrations:.unsafe:011cd7b63172",
      "packages/db/src/client.ts#loadAppliedMigrations:.unsafe:1b3e82512ded",
      "packages/db/src/client.ts#loadAppliedMigrations:.unsafe:d6ac42909b63",
      "packages/db/src/client.ts#loadAppliedMigrations:.unsafe:e46ca1a1a142",
      "packages/db/src/client.ts#migrationHistoryEntryExists:.unsafe:fc859f500d61",
      "packages/db/src/client.ts#reconcilePendingMigrationHistory:.unsafe:0e04f6f93840",
      "packages/db/src/client.ts#reconcilePendingMigrationHistory:.unsafe:6a9fa2fe3ca4",
      "packages/db/src/client.ts#reconcilePendingMigrationHistory:.unsafe:7fb4c733313e",
      "packages/db/src/client.ts#reconcilePendingMigrationHistory:.unsafe:dae5b792be39",
      "packages/db/src/client.ts#reconcilePendingMigrationHistory:.unsafe:e1e4403341c7",
      "packages/db/src/client.ts#recordMigrationHistoryEntry:.unsafe:6a9fa2fe3ca4",
      "packages/db/src/schema/company_brain_edges.ts#<module>:.raw:04b29159c874",
      "packages/db/src/schema/company_brain_edges.ts#<module>:.raw:30517078e05a",
      "packages/db/src/schema/company_brain_edges.ts#<module>:.raw:9e956052e63f",
      "server/src/db/rls-bootstrap.ts#bootstrapRlsCanary:.unsafe:0c6aeeee15c2",
      "server/src/db/rls-bootstrap.ts#bootstrapRlsCanary:.unsafe:a321b270a566",
      "server/src/db/rls-bootstrap.ts#bootstrapRlsCanary:.unsafe:db3d79e1a54e",
      "server/src/index.ts#maybeProvisionDistributedExecutionRoles:.unsafe:326335454339",
      "server/src/services/comment-wakeup-outbox.ts#claimOneRow:.raw:de6ed04ad69b",
      "server/src/services/embeddings.ts#processQueue:.raw:6a66fe80944e",
      "server/src/services/execution-workspaces.ts#tryClaimWorkspaceRun:.raw:e678f0747f5c",
      "server/src/services/internal-agent/conversation.ts#claimTurn:.raw:852b69d2495a",
      "server/src/services/memory-projection.ts#buildMemoryInsert:.raw:4c5170ac8630",
      "server/src/services/memory-projection.ts#buildMemoryInsert:.raw:6b4e01ae278b",
      "server/src/services/mention-outbox.ts#claimOneRow:.raw:3d6aba2162f3",
    ]);

    const injected = scanAuthorityWriters([...sourceFiles,
      {
        file: "server/src/services/injected-authority-barrel.ts",
        source: `export { executionTargets as authorityRows, workers as workerRows } from "@armyofagents/db";`,
      },
      {
        file: "server/src/services/injected-platform-bypass.ts",
        source: `export async function injectedBypass(tx: any) {
          await tx.update(executionTargets).set({ status: "offline" });
        }`,
      },
      {
        file: "server/src/services/injected-aliased-bypass.ts",
        source: `import { executionTargets as importedTargets } from "@armyofagents/db";
          const targetTable = importedTargets;
          export async function injectedAliasedBypass(tx: any) {
            await tx.update(targetTable).set({ deviceGeneration: 2 });
          }
          export async function shadowedAliasIsNotTheImportedTable(tx: any, targetTable: unknown) {
            await tx.update(targetTable).set({ status: "not-an-authority-write" });
          }`,
      },
      {
        file: "server/src/services/injected-dynamic-bypass.ts",
        source: `export async function injectedDynamicBypass(tx: any, patch: any) {
          await tx.update(executionTargets).set(patch);
        }
        export async function injectedSpreadBypass(tx: any, patch: any) {
          await tx.update(executionTargets).set({ ...patch });
        }`,
      },
      {
        file: "server/src/services/injected-raw-bypass.ts",
        source: "const rawTarget = executionTargets;\n" +
          "export async function injectedRawBypass(tx: any) { await tx`UPDATE public.execution_targets AS et SET status = 'offline'`; }\n" +
          "export async function injectedInterpolatedRawBypass(tx: any) { await tx`UPDATE ${rawTarget} SET ${column} = 'offline'`; }\n" +
          "export async function injectedUnsafeRawBypass(tx: any) { await tx.unsafe(\"UPDATE workers AS w SET status = 'revoked'\"); }\n" +
          "export async function injectedSqlRawBypass() { return sql.raw(\"UPDATE public.execution_targets SET device_generation = 9\"); }",
      },
      {
        file: "server/src/services/injected-destructured-assignment-bypass.ts",
        source: `import * as schema from "@armyofagents/db";
          import { authorityRows as reexportedRows } from "./injected-authority-barrel.js";
          const { executionTargets: destructuredRows } = schema;
          const authorityPatch = { status: "offline" };
          const authoritySet = { ...authorityPatch };
          const authorityConflictOptions = { target: reexportedRows.id, set: authoritySet };
          let assignedRows: unknown;
          assignedRows = destructuredRows;
          export async function destructuredBypass(tx: any) {
            await tx.update(destructuredRows).set({ status: "offline" });
          }
          export async function assignmentBypass(tx: any) {
            await tx.update(assignedRows).set({ deviceGeneration: 4 });
          }
          export async function reexportedBypass(tx: any) {
            await tx.update(reexportedRows).set({ workerTokenHash: null });
          }
          export async function upsertBypass(tx: any) {
            await tx.insert(reexportedRows).values({}).onConflictDoUpdate(authorityConflictOptions);
          }
          export async function shorthandUpsertBypass(tx: any) {
            const set = authorityPatch;
            await tx.insert(reexportedRows).values({}).onConflictDoUpdate({
              target: reexportedRows.id, set,
            });
          }
          export async function dynamicUpsertBypass(tx: any, options: unknown) {
            await tx.insert(reexportedRows).values({}).onConflictDoUpdate(options);
          }
          export async function deleteBypass(tx: any) {
            await tx.delete(reexportedRows).where(ok);
          }`,
      },
    ]).map(writerIdentity);
    expect.soft(injected.filter((identity) => identity.startsWith("server/src/services/injected-"))).toEqual([
      "server/src/services/injected-aliased-bypass.ts#injectedAliasedBypass:executionTargets:deviceGeneration:authority",
      "server/src/services/injected-dynamic-bypass.ts#injectedDynamicBypass:executionTargets:<dynamic>:authority",
      "server/src/services/injected-dynamic-bypass.ts#injectedSpreadBypass:executionTargets:<dynamic>:authority",
      "server/src/services/injected-destructured-assignment-bypass.ts#assignmentBypass:executionTargets:deviceGeneration:authority",
      "server/src/services/injected-destructured-assignment-bypass.ts#destructuredBypass:executionTargets:status:authority",
      "server/src/services/injected-destructured-assignment-bypass.ts#reexportedBypass:executionTargets:workerTokenHash:authority",
      "server/src/services/injected-destructured-assignment-bypass.ts#upsertBypass:executionTargets:status:authority",
      "server/src/services/injected-destructured-assignment-bypass.ts#shorthandUpsertBypass:executionTargets:status:authority",
      "server/src/services/injected-destructured-assignment-bypass.ts#dynamicUpsertBypass:executionTargets:<dynamic>:authority",
      "server/src/services/injected-destructured-assignment-bypass.ts#deleteBypass:executionTargets:<delete>:authority",
      "server/src/services/injected-platform-bypass.ts#injectedBypass:executionTargets:status:authority",
      "server/src/services/injected-raw-bypass.ts#injectedInterpolatedRawBypass:executionTargets:<dynamic>:authority",
      "server/src/services/injected-raw-bypass.ts#injectedRawBypass:executionTargets:status:authority",
      "server/src/services/injected-raw-bypass.ts#injectedSqlRawBypass:executionTargets:deviceGeneration:authority",
      "server/src/services/injected-raw-bypass.ts#injectedUnsafeRawBypass:workers:status:authority",
    ].sort());
    expect.soft(scanDynamicRawSqlSites([...sourceFiles, {
      file: "server/src/services/injected-dynamic-raw-bypass.ts",
      source: `export async function injectedDynamicRawBypass(tx: any, statement: string) {
        await tx.unsafe(statement);
      }`,
    }]).filter((identity) => identity.startsWith("server/src/services/injected-"))).toEqual([
      "server/src/services/injected-dynamic-raw-bypass.ts#injectedDynamicRawBypass:.unsafe:b111c6e1d318",
    ]);

    const authorityHelperImport = `import { acquirePlatformTargetAuthorityExclusive }
      from "../../platform-target-authority-lock.js";\n`;
    const guarded = authorityHelperImport + `async function guarded(tx: any) {
      await tx.select().from(executionTargets).where(ok).for("update");
      await tx.select().from(workers).where(ok).for("update");
      await acquirePlatformTargetAuthorityExclusive(tx, targetId);
      await tx.update(executionTargets).set({ status: "offline" });
    }`;
    const wrongOrder = authorityHelperImport + `async function wrongOrder(tx: any) {
      await tx.select().from(executionTargets).where(ok).for("update");
      await acquirePlatformTargetAuthorityExclusive(tx, targetId);
      await tx.select().from(workers).where(ok).for("update");
      await tx.update(executionTargets).set({ status: "offline" });
    }`;
    const unguarded = `async function unguarded(tx: any) {
      await tx.update(executionTargets).set({ deviceGeneration: 2 });
    }`;
    const rawWrongOrder = authorityHelperImport + "async function rawWrongOrder(tx: any) { " +
      "await tx`SELECT id FROM workers FOR UPDATE`; " +
      "await tx`SELECT id FROM execution_targets FOR UPDATE`; " +
      "await acquirePlatformTargetAuthorityExclusive(tx, id); " +
      "await tx`UPDATE execution_targets SET status = 'offline'`; }";
    const rawGuarded = authorityHelperImport + "async function rawGuarded(tx: any) { " +
      "await tx`SELECT id FROM execution_targets FOR UPDATE`; " +
      "await tx`SELECT id FROM workers FOR UPDATE`; " +
      "await acquirePlatformTargetAuthorityExclusive(tx, id); " +
      "await tx`UPDATE execution_targets SET status = 'offline'`; }";
    const branchBypass = authorityHelperImport + `async function branchBypass(tx: any, shouldLock: boolean) {
      if (shouldLock) {
        await tx.select().from(executionTargets).where(ok).for("update");
        await tx.select().from(workers).where(ok).for("update");
        await acquirePlatformTargetAuthorityExclusive(tx, targetId);
      }
      await tx.update(executionTargets).set({ status: "offline" });
    }`;
    const rawUnsafeUnguarded = `async function rawUnsafeUnguarded(tx: any) {
      await tx.unsafe("UPDATE public.execution_targets AS target SET status = 'offline'");
    }`;
    const workerUnguarded = `async function workerUnguarded(tx: any) {
      await tx.update(workers).set({ deviceGeneration: 2 });
    }`;
    const tryCatchBypass = authorityHelperImport + `async function tryCatchBypass(tx: any) {
      try {
        await tx.select().from(executionTargets).where(ok).for("update");
        await tx.select().from(workers).where(ok).for("update");
        await acquirePlatformTargetAuthorityExclusive(tx, targetId);
        throw new Error("race");
      } catch {
        await tx.update(executionTargets).set({ status: "offline" });
      }
    }`;
    const shadowedExclusiveBypass = authorityHelperImport + `async function shadowedExclusiveBypass(tx: any) {
      const acquirePlatformTargetAuthorityExclusive = async () => undefined;
      await tx.select().from(executionTargets).where(ok).for("update");
      await tx.select().from(workers).where(ok).for("update");
      await acquirePlatformTargetAuthorityExclusive();
      await tx.update(executionTargets).set({ status: "offline" });
    }`;
    const shadowedCombinedBypass = `async function shadowedCombinedBypass(tx: any) {
      const lockPlatformAuthorityForMutation = async () => true;
      await lockPlatformAuthorityForMutation();
      await tx.update(executionTargets).set({ status: "offline" });
    }`;
    const fakeSuffixImportBypass = `import { acquirePlatformTargetAuthorityExclusive }
      from "./fake/platform-target-authority-lock.js";
      async function fakeSuffixImportBypass(tx: any) {
        await tx.select().from(executionTargets).where(ok).for("update");
        await tx.select().from(workers).where(ok).for("update");
        await acquirePlatformTargetAuthorityExclusive(tx, targetId);
        await tx.update(executionTargets).set({ status: "offline" });
      }`;
    const unrelatedThisDelegateBypass = `const unrelated = {
      async lockPlatformAuthorityForMutation() { return true; },
      async unrelatedThisDelegateBypass(tx: any) {
        await this.lockPlatformAuthorityForMutation();
        await tx.update(executionTargets).set({ status: "offline" });
      },
    };`;
    expect.soft(platformGuardOrderViolations(guarded)).toEqual([]);
    expect.soft(platformGuardOrderViolations(wrongOrder)).toEqual(["wrongOrder"]);
    expect.soft(platformGuardOrderViolations(unguarded)).toEqual(["unguarded"]);
    expect.soft(platformGuardOrderViolations(rawWrongOrder)).toEqual(["rawWrongOrder"]);
    expect.soft(platformGuardOrderViolations(rawGuarded)).toEqual([]);
    expect.soft(platformGuardOrderViolations(branchBypass)).toEqual(["branchBypass"]);
    expect.soft(platformGuardOrderViolations(rawUnsafeUnguarded)).toEqual(["rawUnsafeUnguarded"]);
    expect.soft(platformGuardOrderViolations(workerUnguarded)).toEqual(["workerUnguarded"]);
    expect.soft(platformGuardOrderViolations(tryCatchBypass)).toEqual(["tryCatchBypass"]);
    expect.soft(platformGuardOrderViolations(shadowedExclusiveBypass)).toContain("shadowedExclusiveBypass");
    expect.soft(platformGuardOrderViolations(shadowedCombinedBypass)).toContain("shadowedCombinedBypass");
    expect.soft(platformGuardOrderViolations(fakeSuffixImportBypass)).toContain("fakeSuffixImportBypass");
    expect.soft(platformGuardOrderViolations(unrelatedThisDelegateBypass)).toContain("unrelatedThisDelegateBypass");

    const sourceByFile = new Map(sourceFiles.map((entry) => [entry.file, entry.source]));
    const exactNonPlatformWriters = new Set([
      "server/src/services/execution-targets.ts#registerWorkerHeartbeat",
      "server/src/services/execution-targets.ts#revokeExecutionTargetWorkerToken",
      "server/src/services/execution-targets.ts#rotateExecutionTargetWorkerToken",
    ]);
    const exactReviewedThisDelegates = new Set([
      "packages/db/src/repositories/tenant/worker-enrollment.ts#revokeTargetAuthority",
    ]);
    for (const writer of authorityWriters.filter((entry) => entry.mode === "authority")) {
      const key = `${writer.file}#${writer.functionName}`;
      const functionSource = namedFunctionAuditSource(sourceByFile.get(writer.file)!, writer.functionName);
      if (exactNonPlatformWriters.has(key)) {
        expect.soft(
          functionSource,
          `${key} may be exempt only while it has an explicit non-null Organization predicate`,
        ).toMatch(/isNotNull\(executionTargets\.organizationId\)|eq\(executionTargets\.organizationId,\s*input\.organizationId\)/);
        expect.soft(functionSource, `${key} must never accept a null-Org platform row`).not.toMatch(
          /isNull\(executionTargets\.organizationId\)/,
        );
        continue;
      }
      expect.soft(
        platformGuardOrderViolations(functionSource, true, exactReviewedThisDelegates.has(key)),
        `${key} must prove target -> worker -> named exclusive authority before every mutation`,
      ).toEqual([]);
    }
    const targetWriters = sourceByFile.get("server/src/services/execution-targets.ts")!;
    const workerRepository = sourceByFile.get(
      "packages/db/src/repositories/tenant/worker-enrollment.ts",
    )!;
    const operatorRepository = sourceByFile.get(
      "packages/db/src/repositories/operator/job-leasing.ts",
    )!;
    expect.soft(platformGuardOrderViolations(namedFunctionAuditSource(
      targetWriters,
      "ratifyPlatformExecutionTargetPlacementProfile",
    ))).toEqual([]);
    expect.soft(platformGuardOrderViolations(namedFunctionAuditSource(
      workerRepository,
      "lockPlatformAuthorityForMutation",
    ))).toEqual([]);
    expect.soft(platformGuardOrderViolations(namedFunctionAuditSource(
      workerRepository,
      "revokeTargetAuthority",
    ))).toEqual([]);
    expect.soft(platformGuardOrderViolations(namedFunctionAuditSource(
      operatorRepository,
      "lockPlatformAuthorityForMutation",
    ))).toEqual([]);

    const writerFiles = new Set(inventory.map((identity) => identity.slice(0, identity.indexOf("#"))));
    for (const { file, source } of sourceFiles.filter((entry) => writerFiles.has(entry.file))) {
      expect(source, `${file} must not widen platform target RLS or grants`).not.toContain(
        "execution_targets_tenant_enrollment_update",
      );
    }
  });

  it("selects one database-native global head with an exact static-certificate anti-join", () => {
    const repository = readFileSync(
      new URL("../../../packages/db/src/repositories/tenant/job-control.ts", import.meta.url),
      "utf8",
    );
    const leasing = readFileSync(new URL("../services/job-leasing.ts", import.meta.url), "utf8");
    const scheduler = readFileSync(new URL("../services/job-ready-scheduler.ts", import.meta.url), "utf8");
    const candidateQuery = namedFunctionSource(repository, "lockEligibleLeaseCandidates");
    const candidateSignature = namedInterfaceMethodSource(
      repository,
      "JobControlRepository",
      "lockEligibleLeaseCandidates",
    );
    const exactCandidateInputMembers = [
      "admissibleWorkloadTypes",
      "eligibilityVersion",
      "limit",
      "staticContextHash",
      "targetAuthorityKey",
      "targetClass",
      "targetGeneration",
      "targetId",
      "targetOwner",
      "targetProfileHash",
      "targetProviderConstraintHash",
      "targetScope",
      "workerId",
    ];
    const pollService = namedFunctionSource(leasing, "poll");

    expect.soft(repository).not.toMatch(/lockEligibleLeaseCandidates[\s\S]{0,500}attemptIds\??:/);
    expect.soft(forbiddenLeaseContinuationIdentifiers(repository)).not.toContain("LeaseCandidateCursor");
    expect.soft(forbiddenLeaseContinuationIdentifiers(candidateSignature)).toEqual([]);
    expect.soft(forbiddenLeaseContinuationIdentifiers(candidateQuery)).toEqual([]);
    expect.soft(forbiddenLeaseContinuationIdentifiers(pollService)).toEqual([]);
    expect.soft(namedInterfaceMethodInputMembers(
      repository,
      "JobControlRepository",
      "lockEligibleLeaseCandidates",
    )).toEqual(exactCandidateInputMembers);
    expect.soft(namedFunctionInputProperties(
      repository,
      "lockEligibleLeaseCandidates",
      "input",
    )).toEqual(exactCandidateInputMembers);
    expect.soft(candidateQuery).not.toMatch(
      /\b(?:gt|gte|lt)\(jobs\.(?:availableAt|priority|createdAt|id),/,
    );
    expect.soft(namedFunctionMainWhereConjuncts(
      repository,
      "lockEligibleLeaseCandidates",
    )).toEqual([
      'eq(jobAttempts.placementDisposition,"selected")',
      'eq(jobAttempts.placementLeaseEligible,true)',
      'eq(jobAttempts.placementMode,"active")',
      'eq(jobAttempts.placementOwner,input.targetOwner)',
      'eq(jobAttempts.placementProfileHash,input.targetProfileHash)',
      'eq(jobAttempts.placementProviderConstraintHash,input.targetProviderConstraintHash)',
      'eq(jobAttempts.placementTargetClass,input.targetClass)',
      'eq(jobAttempts.placementTargetGeneration,input.targetGeneration)',
      'eq(jobAttempts.placementTargetId,input.targetId)',
      'eq(jobAttempts.placementTargetScope,input.targetScope)',
      'eq(jobAttempts.status,"pending")',
      'eq(jobs.status,"queued")',
      'inArray(jobs.workloadType,input.admissibleWorkloadTypes)',
      'lte(jobs.availableAt,sql`statement_timestamp()`)',
      'notExists(workerLeaseRejections)',
    ].sort());
    expect.soft(candidateQuery).toContain("workerLeaseRejections");
    expect.soft(candidateQuery).toMatch(/notExists\s*\(|NOT EXISTS/i);
    const exactCertificateEqualities = [
      ["organizationId", "jobAttempts.organizationId"],
      ["companyId", "jobAttempts.companyId"],
      ["jobId", "jobAttempts.jobId"],
      ["attemptId", "jobAttempts.id"],
      ["workerId", "input.workerId"],
      ["targetId", "input.targetId"],
      ["targetAuthorityKey", "input.targetAuthorityKey"],
      ["workloadType", "jobs.workloadType"],
      ["placementOwner", "jobAttempts.placementOwner"],
      ["placementTargetClass", "jobAttempts.placementTargetClass"],
      ["placementTargetScope", "jobAttempts.placementTargetScope"],
      ["placementTargetGeneration", "jobAttempts.placementTargetGeneration"],
      ["placementProfileHash", "jobAttempts.placementProfileHash"],
      ["placementProviderConstraintHash", "jobAttempts.placementProviderConstraintHash"],
      ["placementInputDigest", "jobAttempts.placementInputDigest"],
      ["placementPolicyDigest", "jobAttempts.placementPolicyDigest"],
      ["eligibilityVersion", "input.eligibilityVersion"],
      ["staticContextHash", "input.staticContextHash"],
    ] as const;
    for (const [certificateColumn, currentValue] of exactCertificateEqualities) {
      expect.soft(
        candidateQuery,
        `certificate anti-join must bind ${certificateColumn} to ${currentValue}`,
      ).toMatch(new RegExp(
        `eq\\(workerLeaseRejections\\.${certificateColumn},\\s*${currentValue.replaceAll(".", "\\.")}\\)`,
      ));
    }
    expect.soft(repository).toContain("statement_timestamp()");
    expect.soft(repository).toMatch(
      /orderBy\(asc\(jobs\.availableAt\),\s*desc\(jobs\.priority\),\s*asc\(jobs\.createdAt\),\s*asc\(jobs\.id\)\)/,
    );
    expect.soft(repository).toMatch(/\.limit\(256\)/);
    expect.soft(repository).toMatch(/\.for\(["']update["'],\s*\{[^}]*skipLocked:\s*true/);
    expect.soft(repository).toMatch(/inArray\(jobs\.workloadType,\s*input\.admissibleWorkloadTypes\)/);

    expect.soft(leasing).not.toContain("hintedAttemptIds");
    expect.soft(leasing).not.toMatch(/scheduler\?\.take|scheduler\.take/);
    expect.soft(leasing).toContain("LEASE_STATIC_ELIGIBILITY_VERSION");
    expect.soft(leasing).toContain("static_requirements_mismatch");
    expect.soft(leasing).toMatch(/(?:MAX_|max).*HEAD.*RESTART|headRestart/si);
    expect.soft(leasing).toMatch(/(?:3|THREE)[\s\S]{0,100}(?:restart|attempt)/i);
    expect.soft(leasing.match(/snapshotLiveLeaseCapacity\s*\(/g) ?? []).toHaveLength(1);
    expect.soft(leasing).not.toMatch(/for\s*\([^)]*candidate[^)]*\)[\s\S]{0,500}countLiveWorkerLeases/);
    const hasCapacitySnapshot = repository.includes("snapshotLiveLeaseCapacity");
    expect.soft(hasCapacitySnapshot).toBe(true);
    if (hasCapacitySnapshot) {
      const capacitySnapshot = namedFunctionSource(repository, "snapshotLiveLeaseCapacity");
      for (const predicate of ["organizationId", "workerId", "targetId"]) {
        expect.soft(capacitySnapshot, `capacity snapshot must bind ${predicate}`).toContain(predicate);
      }
      expect.soft(capacitySnapshot).toMatch(/groupBy\([^)]*workloadType|FILTER\s*\(\s*WHERE[^)]*workload_type/is);
      expect.soft(capacitySnapshot).not.toMatch(/executionTargetId[\s\S]{0,500}(?:organizationId\s+IS\s+NULL|isNull\([^)]*organization)/i);
    }
    expect.soft(repository).toMatch(/cleanupLeaseRejectionCertificates[\s\S]*\.limit\(256\)/);
    expect.soft(repository).toMatch(/cleanupLeaseRejectionCertificates[\s\S]*(?:terminal|retired|status)/i);
    expect.soft(scheduler).not.toContain("attemptId");
    expect.soft(scheduler).toMatch(/consume\(/);
  });

  it("keeps protected candidate facts immutable and certificate writers certificate-only", () => {
    const production = [
      ...productionTypeScriptFiles(join(repositoryRoot, "server", "src")),
      ...productionTypeScriptFiles(join(repositoryRoot, "packages", "db", "src")),
    ].map((path) => ({
      file: relative(repositoryRoot, path).replaceAll("\\", "/"),
      source: readFileSync(path, "utf8"),
    }));
    const protectedFields = new Map<string, Set<string>>([
      ["jobs", new Set([
        "workloadType", "input", "inputHash", "policySnapshot", "policyHash",
        "requirements", "placementRequest", "priority", "availableAt", "createdAt",
      ])],
      ["jobAttempts", new Set([
        "placementDisposition", "placementOwner", "placementTargetId",
        "placementTargetClass", "placementTargetScope", "placementTargetGeneration",
        "placementProfileHash", "placementProviderConstraintHash",
        "placementMode", "placementLeaseEligible", "placementInputDigest",
        "placementPolicyDigest", "placementDecidedAt",
      ])],
    ]);

    function scan(inputs: typeof production): string[] {
      const found: string[] = [];
      type CandidateTable = "jobs" | "jobAttempts";
      const exportedAliases = new Map<string, CandidateTable>([
        ["jobs", "jobs"],
        ["jobAttempts", "jobAttempts"],
      ]);
      for (let pass = 0; pass < 4; pass += 1) {
        for (const input of inputs) {
          const source = ts.createSourceFile(input.file, input.source, ts.ScriptTarget.Latest, true);
          const collectExport = (node: ts.Node): void => {
            if (ts.isExportSpecifier(node)) {
              const local = node.propertyName?.text ?? node.name.text;
              const table = exportedAliases.get(local);
              if (table) exportedAliases.set(node.name.text, table);
            }
            if (ts.isVariableStatement(node) &&
                node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
              for (const declaration of node.declarationList.declarations) {
                if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
                const sourceName = ts.isIdentifier(declaration.initializer)
                  ? declaration.initializer.text
                  : ts.isPropertyAccessExpression(declaration.initializer)
                    ? declaration.initializer.name.text
                    : null;
                const table = sourceName ? exportedAliases.get(sourceName) : undefined;
                if (table) exportedAliases.set(declaration.name.text, table);
              }
            }
            ts.forEachChild(node, collectExport);
          };
          collectExport(source);
        }
      }
      for (const input of inputs) {
        const file = ts.createSourceFile(input.file, input.source, ts.ScriptTarget.Latest, true);
        type CandidateDeclaration = {
          name: string;
          table: CandidateTable | null;
          start: number;
          scopeStart: number;
          scopeEnd: number;
        };
        const declarations: CandidateDeclaration[] = [];
        const objects = new Map<string, string[]>();
        const scopeOf = (node: ts.Node): ts.Node => {
          let current: ts.Node | undefined = node.parent;
          while (current && !ts.isBlock(current) && !ts.isSourceFile(current) && !ts.isFunctionLike(current)) {
            current = current.parent;
          }
          return current ?? file;
        };
        const tableName = (node: ts.Expression | undefined, useNode: ts.Node): CandidateTable | null => {
          if (!node) return null;
          if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
            return tableName(node.expression, useNode);
          }
          if (ts.isPropertyAccessExpression(node)) {
            if (protectedFields.has(node.name.text)) return node.name.text as CandidateTable;
            return exportedAliases.get(node.name.text) ?? null;
          }
          if (!ts.isIdentifier(node)) return null;
          const use = useNode.getStart(file);
          const visible = declarations.filter((declaration) =>
            declaration.name === node.text && declaration.start <= use &&
            declaration.scopeStart <= use && use <= declaration.scopeEnd)
            .sort((left, right) =>
              (left.scopeEnd - left.scopeStart) - (right.scopeEnd - right.scopeStart) ||
              right.start - left.start);
          if (visible.length > 0) return visible[0]!.table;
          if (protectedFields.has(node.text)) return node.text as CandidateTable;
          return exportedAliases.get(node.text) ?? null;
        };
        const addDeclaration = (
          name: string,
          table: CandidateTable | null,
          node: ts.Node,
          scope = scopeOf(node),
        ): void => {
          declarations.push({
            name,
            table,
            start: node.getStart(file),
            scopeStart: scope.getStart(file),
            scopeEnd: scope.getEnd(),
          });
        };
        const collect = (node: ts.Node): void => {
          if (ts.isImportSpecifier(node)) {
            const imported = node.propertyName?.text ?? node.name.text;
            addDeclaration(
              node.name.text,
              exportedAliases.get(imported) ?? null,
              node,
              file,
            );
          }
          if (ts.isExportSpecifier(node)) {
            const imported = node.propertyName?.text ?? node.name.text;
            addDeclaration(node.name.text, exportedAliases.get(imported) ?? null, node, file);
          }
          if (ts.isFunctionLike(node)) {
            for (const parameter of node.parameters) {
              if (ts.isIdentifier(parameter.name)) addDeclaration(parameter.name.text, null, parameter, node);
            }
          }
          if (ts.isVariableDeclaration(node)) {
            if (ts.isIdentifier(node.name) && node.initializer) {
              addDeclaration(node.name.text, tableName(node.initializer, node), node);
              const fields = expressionObjectFields(node.initializer, objects, new Map());
              if (fields.some((field) => field !== "<dynamic>")) objects.set(node.name.text, fields);
            } else if (ts.isObjectBindingPattern(node.name)) {
              for (const element of node.name.elements) {
                if (!ts.isIdentifier(element.name)) continue;
                const sourceName = propertyName(element.propertyName) ?? element.name.text;
                addDeclaration(element.name.text, exportedAliases.get(sourceName) ?? null, element);
              }
            }
          }
          if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
              ts.isIdentifier(node.left)) {
            addDeclaration(node.left.text, tableName(node.right, node), node);
          }
          ts.forEachChild(node, collect);
        };
        collect(file);
        const record = (node: ts.Node, table: string, fields: string[]): void => {
          const protectedForTable = protectedFields.get(table);
          if (!protectedForTable) return;
          const relevant = [...new Set(fields.filter((field) =>
            protectedForTable.has(field) || field === "<dynamic>" || field === "<computed>"))].sort();
          if (relevant.length > 0) {
            found.push(`${input.file}#${enclosingFunctionName(node)}:${table}:${relevant.join(",")}`);
          }
        };
        const visit = (node: ts.Node): void => {
          if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
              node.expression.name.text === "set") {
            const update = node.expression.expression;
            if (ts.isCallExpression(update) && ts.isPropertyAccessExpression(update.expression) &&
                update.expression.name.text === "update") {
              const table = tableName(update.arguments[0], node) ?? "";
              const values = node.arguments[0];
              record(node, table, expressionObjectFields(values, objects, new Map()));
            }
          }
          if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
              node.expression.name.text === "onConflictDoUpdate" && node.arguments[0] &&
              ts.isObjectLiteralExpression(node.arguments[0])) {
            let chain: ts.Expression = node.expression.expression;
            let insertedTable = "";
            while (ts.isCallExpression(chain) && ts.isPropertyAccessExpression(chain.expression)) {
              if (chain.expression.name.text === "insert") {
                insertedTable = tableName(chain.arguments[0], node) ?? "";
                break;
              }
              chain = chain.expression.expression;
            }
            const setProperty = node.arguments[0].properties.find((property) =>
              ts.isPropertyAssignment(property) && propertyName(property.name) === "set");
            if (setProperty && ts.isPropertyAssignment(setProperty)) {
              record(node, insertedTable, expressionObjectFields(setProperty.initializer, objects, new Map()));
            }
          }
          if (ts.isTaggedTemplateExpression(node)) {
            const raw = templateText(node);
            const match = /\bUPDATE\s+(?:"?public"?\.)?"?(jobs|job_attempts)"?(?:\s+(?:AS\s+)?\w+)?\s+SET\s+([\s\S]*?)(?:\bWHERE\b|$)/i.exec(raw);
            let table = match?.[1] === "jobs" ? "jobs" : match?.[1] === "job_attempts" ? "jobAttempts" : null;
            let assignments = match?.[2] ?? "";
            if (!table && /^\s*UPDATE\s+\?/i.test(raw) && ts.isTemplateExpression(node.template)) {
              table = tableName(node.template.templateSpans[0]?.expression, node);
              assignments = raw.replace(/^\s*UPDATE\s+\?\s+(?:AS\s+\w+\s+)?SET\s+/i, "");
            }
            if (table) {
              const fields = [...assignments.matchAll(/"?([a-z][a-z0-9_]*)"?\s*=/gi)]
                .map((field) => sqlFieldName(field[1]!.toLowerCase()));
              record(node, table, fields.length > 0 ? fields : ["<dynamic>"]);
            }
          }
          if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
              (node.expression.name.text === "unsafe" || node.expression.name.text === "raw")) {
            const argument = node.arguments[0];
            const raw = argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
              ? argument.text
              : "";
            const match = /\bUPDATE\s+(?:"?public"?\.)?"?(jobs|job_attempts)"?(?:\s+(?:AS\s+)?\w+)?\s+SET\s+([\s\S]*?)(?:\bWHERE\b|$)/i.exec(raw);
            if (match) {
              const table = match[1] === "jobs" ? "jobs" : "jobAttempts";
              const fields = [...match[2]!.matchAll(/"?([a-z][a-z0-9_]*)"?\s*=/gi)]
                .map((field) => sqlFieldName(field[1]!.toLowerCase()));
              record(node, table, fields.length > 0 ? fields : ["<dynamic>"]);
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(file);
      }
      return found.sort();
    }

    expect.soft(scan(production)).toEqual([
      "packages/db/src/repositories/tenant/job-control.ts#persistPlacementDecision:jobAttempts:placementDecidedAt,placementDisposition,placementInputDigest,placementLeaseEligible,placementMode,placementOwner,placementPolicyDigest,placementProfileHash,placementProviderConstraintHash,placementTargetClass,placementTargetGeneration,placementTargetId,placementTargetScope",
    ]);
    const injected = scan([...production, {
      file: "server/src/services/injected-candidate-barrel.ts",
      source: `export { jobs as queuedRows, jobAttempts as attemptRows } from "@armyofagents/db";`,
    }, {
      file: "server/src/services/injected-candidate-mutation.ts",
      source: `import * as schema from "@armyofagents/db";
      import { jobs as importedJobs, jobAttempts as importedAttempts } from "@armyofagents/db";
      import { queuedRows as reexportedJobs, attemptRows as reexportedAttempts } from "./injected-candidate-barrel.js";
      const jobsPatch = {
        workloadType: "batch", input: {}, inputHash: "x", policySnapshot: {}, policyHash: "x",
        requirements: {}, placementRequest: {}, priority: 9, availableAt: new Date(), createdAt: new Date(),
      };
      const attemptsPatch = {
        placementDisposition: "selected", placementOwner: "managed_cloud", placementTargetId: "x",
        placementTargetClass: "managed_cloud", placementTargetScope: "platform",
        placementTargetGeneration: 2, placementProfileHash: "x", placementProviderConstraintHash: "x",
        placementMode: "active", placementLeaseEligible: true, placementInputDigest: "x",
        placementPolicyDigest: "x", placementDecidedAt: new Date(),
      };
      async function mutateAll(tx: any) {
        await tx.update(importedJobs).set({ ...jobsPatch });
        await tx.update(importedAttempts).set({ ...attemptsPatch });
      }
      async function mutateDynamic(tx: any, patch: any, field: string) {
        await tx.update(jobAttempts).set(patch);
        await tx.update(jobs).set({ ...patch });
        await tx.update(jobAttempts).set({ [field]: "changed" });
      }
      async function mutateConflict(tx: any) {
        await tx.insert(importedJobs).values({}).onConflictDoUpdate({ target: importedJobs.id, set: jobsPatch });
      }
      async function mutateRaw(tx: any) {
        await tx\`UPDATE public.job_attempts AS attempt SET placement_profile_hash = 'changed'\`;
        await tx.unsafe("UPDATE public.jobs AS job SET policy_hash = 'changed'");
        await sql.raw("UPDATE public.job_attempts SET placement_policy_digest = 'changed'");
      }
      const aliasAttempts = importedAttempts;
      const { jobs: destructuredJobs, jobAttempts: destructuredAttempts } = schema;
      let assignedJobs: unknown;
      assignedJobs = destructuredJobs;
      async function mutateAliasForms(tx: any) {
        await tx.update(destructuredJobs).set({ priority: 10 });
        await tx.update(destructuredAttempts).set({ placementLeaseEligible: false });
        await tx.update(assignedJobs).set({ availableAt: new Date() });
        await tx.update(reexportedJobs).set({ policyHash: "changed" });
        await tx.update(reexportedAttempts).set({ placementPolicyDigest: "changed" });
      }
      async function mutateInterpolatedRaw(tx: any, field: unknown) {
        await tx\`UPDATE \${aliasAttempts} SET \${field} = 'changed'\`;
      }
      async function shadowedProtectedAliasIsNotTheTable(tx: any, importedJobs: unknown) {
        await tx.update(importedJobs).set({ workloadType: "not-a-table" });
      }`,
    }]);
    expect.soft(injected).toContain(
      "server/src/services/injected-candidate-mutation.ts#mutateAll:jobs:availableAt,createdAt,input,inputHash,placementRequest,policyHash,policySnapshot,priority,requirements,workloadType",
    );
    expect.soft(injected).toContain(
      "server/src/services/injected-candidate-mutation.ts#mutateAll:jobAttempts:placementDecidedAt,placementDisposition,placementInputDigest,placementLeaseEligible,placementMode,placementOwner,placementPolicyDigest,placementProfileHash,placementProviderConstraintHash,placementTargetClass,placementTargetGeneration,placementTargetId,placementTargetScope",
    );
    expect.soft(injected).toContain(
      "server/src/services/injected-candidate-mutation.ts#mutateDynamic:jobAttempts:<dynamic>",
    );
    expect.soft(injected).toContain(
      "server/src/services/injected-candidate-mutation.ts#mutateDynamic:jobs:<dynamic>",
    );
    expect.soft(injected).toContain(
      "server/src/services/injected-candidate-mutation.ts#mutateDynamic:jobAttempts:<computed>",
    );
    expect.soft(injected).toContain(
      "server/src/services/injected-candidate-mutation.ts#mutateConflict:jobs:availableAt,createdAt,input,inputHash,placementRequest,policyHash,policySnapshot,priority,requirements,workloadType",
    );
    expect.soft(injected).toContain(
      "server/src/services/injected-candidate-mutation.ts#mutateRaw:jobAttempts:placementProfileHash",
    );
    expect.soft(injected).toContain(
      "server/src/services/injected-candidate-mutation.ts#mutateRaw:jobs:policyHash",
    );
    expect.soft(injected).toContain(
      "server/src/services/injected-candidate-mutation.ts#mutateRaw:jobAttempts:placementPolicyDigest",
    );
    expect.soft(injected).toContain(
      "server/src/services/injected-candidate-mutation.ts#mutateInterpolatedRaw:jobAttempts:<dynamic>",
    );
    for (const identity of [
      "server/src/services/injected-candidate-mutation.ts#mutateAliasForms:jobs:priority",
      "server/src/services/injected-candidate-mutation.ts#mutateAliasForms:jobAttempts:placementLeaseEligible",
      "server/src/services/injected-candidate-mutation.ts#mutateAliasForms:jobs:availableAt",
      "server/src/services/injected-candidate-mutation.ts#mutateAliasForms:jobs:policyHash",
      "server/src/services/injected-candidate-mutation.ts#mutateAliasForms:jobAttempts:placementPolicyDigest",
    ]) {
      expect.soft(injected).toContain(identity);
    }
    expect.soft(injected.some((identity) => identity.includes("#shadowedProtectedAliasIsNotTheTable:"))).toBe(false);

    const repository = readFileSync(
      new URL("../../../packages/db/src/repositories/tenant/job-control.ts", import.meta.url),
      "utf8",
    );
    expect.soft(repository).toMatch(/upsertLeaseRejectionCertificates[\s\S]*workerLeaseRejections/);
    expect.soft(repository).toMatch(/cleanupLeaseRejectionCertificates[\s\S]*workerLeaseRejections/);
    expect.soft(repository).not.toMatch(
      /(?:upsert|cleanup)LeaseRejectionCertificates[\s\S]{0,1500}\.update\((?:workers|executionTargets|jobs|jobAttempts|leases)\)/,
    );
    for (const predicate of ["organizationId", "workerId", "targetId", "attemptId"]) {
      expect.soft(repository, `certificate mutation must bind ${predicate}`).toContain(predicate);
    }
  });
});
