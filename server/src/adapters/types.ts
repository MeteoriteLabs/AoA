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
  AdapterSessionManagement,
  AdapterSkillContext,
  AdapterSkillEntry,
  AdapterSkillOrigin,
  AdapterSkillSnapshot,
  AdapterSkillState,
  AdapterSkillSyncMode,
  NativeContextManagement,
  ResolvedSessionCompactionPolicy,
  SessionCompactionPolicy,
} from "@armyofagents/adapter-utils";

import type {
  AdapterSessionManagement,
  ServerAdapterModule as BaseServerAdapterModule,
} from "@armyofagents/adapter-utils";

/**
 * Declarative schema for adapter configuration UI.
 *
 * Paperclip ships a richer AdapterConfigSchema definition in newer versions of
 * adapter-utils. AoA pins @armyofagents/adapter-utils@0.3.1 which predates that
 * type, so we declare a minimal structural type here. The `/adapters/:type/config-schema`
 * endpoint treats the schema as opaque JSON (hydrated by the adapter), so a
 * permissive shape is sufficient until adapter-utils is upgraded.
 */
export type AdapterConfigSchema = Record<string, unknown>;

/**
 * Extension of adapter-utils ServerAdapterModule with fields that have not
 * yet been ported upstream. Skills-related fields (listSkills, syncSkills,
 * supportsInstructionsBundle, requiresMaterializedRuntimeSkills,
 * instructionsPathKey) are now provided by the upstream type as of Phase I.2.
 */
export interface ServerAdapterModule extends BaseServerAdapterModule {
  sessionManagement?: AdapterSessionManagement;
  getConfigSchema?: () => Promise<AdapterConfigSchema>;
  getQuotaWindows?: () => unknown;
  detectModel?: (...args: unknown[]) => unknown;
}
