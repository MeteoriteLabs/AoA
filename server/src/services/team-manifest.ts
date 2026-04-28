import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { TeamManifestSchema, type TeamManifest } from "@armyofagents/shared";

export function parseManifest(yaml: string): TeamManifest {
  let raw: unknown;
  try {
    raw = parseYaml(yaml);
  } catch (err) {
    throw new Error(`malformed YAML: ${(err as Error).message}`);
  }
  return validateManifest(raw);
}

export function validateManifest(raw: unknown): TeamManifest {
  const result = TeamManifestSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`invalid manifest: ${result.error.message}`);
  }
  for (const rule of result.data.routing.rules) {
    try {
      new RegExp(rule.match);
    } catch (err) {
      throw new Error(`invalid regex in routing rule "${rule.match}": ${(err as Error).message}`);
    }
  }
  return result.data;
}

export function serializeManifest(manifest: TeamManifest): string {
  validateManifest(manifest);
  return stringifyYaml(manifest);
}
