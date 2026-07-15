import { api } from "./client";
import type { CommanderProvider } from "@armyofagents/shared";

/**
 * Commander auth client (Plan 3 / §6.1+§6.2). Two ways to make the Commander
 * CLI usable from onboarding's Verify step without touching a terminal:
 *  - `saveCommanderKey` — paste an API key (stored encrypted server-side; the
 *    raw value never comes back).
 *  - `startCommanderLogin` / `getCommanderLoginStatus` — drive the interactive
 *    device login; open `loginUrl`, poll until `completed`, then re-verify.
 */

export type CommanderLoginStatus = "pending" | "completed" | "failed" | "timeout";

export function saveCommanderKey(args: {
  companyId: string;
  provider: CommanderProvider;
  value: string;
}): Promise<{ ok: boolean; secretId: string }> {
  return api.post(`/companies/${args.companyId}/internal-agent/commander-key`, {
    provider: args.provider,
    value: args.value,
  });
}

export function startCommanderLogin(args: {
  companyId: string;
  provider: CommanderProvider;
}): Promise<{ challengeId: string; loginUrl: string }> {
  return api.post(`/companies/${args.companyId}/internal-agent/commander-login/start`, {
    provider: args.provider,
  });
}

export function getCommanderLoginStatus(args: {
  companyId: string;
  challengeId: string;
}): Promise<{ status: CommanderLoginStatus; loginUrl: string | null }> {
  return api.get(`/companies/${args.companyId}/internal-agent/commander-login/${args.challengeId}`);
}
