import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents } from "@armyofagents/db";
import { secretService } from "../secrets.js";
import {
  mayUseLegacySubscriptionHome,
  resolveAgentSubscriptionEnvironment,
  type CliSubscriptionProvider,
} from "../provider-credential-bindings.js";

function providerForAdapter(adapterType: string): CliSubscriptionProvider | null {
  if (adapterType === "codex_local") return "openai";
  if (adapterType === "claude_local") return "anthropic";
  return null;
}

function stringEnv(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

/**
 * Resolve the exact credential environment used by Commander direct chat.
 *
 * Runtime precedence matches the heartbeat path:
 *   Commander env binding -> company provider API key -> governed subscription
 *   binding -> legacy host login only while scoped auth is not required.
 *
 * Subscription selection is agent-bound rather than user-bound. That lets a
 * teammate use Commander without silently switching it to the teammate's
 * personal CLI home, while still enforcing credential owner membership,
 * company, provider, and execution-target isolation.
 */
export async function resolveCommanderRuntimeEnvironment(
  db: Db,
  args: {
    companyId: string;
    commanderAgentId: string;
    actorUserId: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<Record<string, string>> {
  const [agent] = await db
    .select({
      adapterType: agents.adapterType,
      adapterConfig: agents.adapterConfig,
    })
    .from(agents)
    .where(
      and(
        eq(agents.id, args.commanderAgentId),
        eq(agents.companyId, args.companyId),
      ),
    )
    .limit(1);
  if (!agent) {
    throw new Error("Commander runtime agent is missing for this company.");
  }

  const resolvedConfig = await secretService(db).resolveAdapterConfigForRuntime(
    args.companyId,
    agent.adapterType,
    (agent.adapterConfig as Record<string, unknown> | null) ?? {},
    {
      consumerType: "agent",
      consumerId: args.commanderAgentId,
      actorType: "user",
      actorId: args.actorUserId,
    },
  );
  const resolvedEnv = stringEnv(resolvedConfig.env);
  const provider = providerForAdapter(agent.adapterType);
  if (!provider) return resolvedEnv;

  const apiKeyName = provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  if (resolvedEnv[apiKeyName]?.trim()) return resolvedEnv;

  const runtimeEnv = args.env ?? process.env;
  const scopedCliAuthRequired = /^(1|true|yes)$/i.test(
    runtimeEnv.AOA_SCOPED_CLI_AUTH?.trim() ?? "",
  );
  try {
    const subscriptionEnv = await resolveAgentSubscriptionEnvironment(db, {
      companyId: args.companyId,
      agentId: args.commanderAgentId,
      provider,
      executionTargetId:
        runtimeEnv.AOA_EXECUTION_TARGET_ID?.trim() || "control-plane",
      env: runtimeEnv,
    });
    return { ...resolvedEnv, ...stringEnv(subscriptionEnv) };
  } catch (error) {
    if (!mayUseLegacySubscriptionHome(error, scopedCliAuthRequired)) throw error;
    return resolvedEnv;
  }
}
