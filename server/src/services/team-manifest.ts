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
  // Regex compilability is now validated by TeamManifestSchema.superRefine
  // (D2: consolidates dual validation into the schema layer).
  return result.data;
}

export function serializeManifest(manifest: TeamManifest): string {
  validateManifest(manifest);
  return stringifyYaml(manifest);
}
