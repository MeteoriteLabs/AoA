// Re-export shared adapter-utils types. AoA server code imports from this
// shim so call sites don't need to change when adapter-utils is upgraded.
export type {
  AdapterAgent,
  AdapterRuntime,
  UsageSummary,
  AdapterExecutionResult,
  AdapterInvocationMeta,
  AdapterExecutionContext,
  AdapterEnvironmentCheckLevel,
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestStatus,
  AdapterEnvironmentTestResult,
  AdapterEnvironmentTestContext,
  AdapterSessionCodec,
  AdapterModel,
} from "@paperclipai/adapter-utils";

import type { ServerAdapterModule as BaseServerAdapterModule } from "@paperclipai/adapter-utils";

/**
 * Declarative schema for adapter configuration UI.
 *
 * Paperclip ships a richer AdapterConfigSchema definition in newer versions of
 * adapter-utils. AoA pins @paperclipai/adapter-utils@0.3.1 which predates that
 * type, so we declare a minimal structural type here. The `/adapters/:type/config-schema`
 * endpoint treats the schema as opaque JSON (hydrated by the adapter), so a
 * permissive shape is sufficient until adapter-utils is upgraded.
 */
export type AdapterConfigSchema = Record<string, unknown>;

/**
 * Extension of adapter-utils@0.3.1 ServerAdapterModule that adds optional
 * fields introduced in later Paperclip versions. These fields are read by
 * the /adapters route and by plugin discovery; they are unset on AoA's
 * current builtin adapters (which is fine — they're all optional).
 *
 * When adapter-utils is upgraded in a future phase, remove these additions
 * and let the upstream type define them.
 */
export interface ServerAdapterModule extends BaseServerAdapterModule {
  listSkills?: unknown;
  syncSkills?: unknown;
  supportsInstructionsBundle?: boolean;
  requiresMaterializedRuntimeSkills?: boolean;
  instructionsPathKey?: string;
  sessionManagement?: unknown;
  getConfigSchema?: () => Promise<AdapterConfigSchema>;
  getQuotaWindows?: () => unknown;
  detectModel?: (...args: unknown[]) => unknown;
}
