import type { Request } from "express";
import type { Db } from "@armyofagents/db";
import { forbidden, unauthorized } from "../errors.js";
import { assertTenantMembership, resolveCompanyTenant } from "./authz-tenant.js";
import { tenantIsolationEnforced } from "../config/deployment-mode.js";
import { hasActiveBreakGlass } from "../services/operator-break-glass.js";

export function assertBoard(req: Request) {
  // R9a: an unauthenticated request gets 401 (not the 403 below), mirroring
  // assertCompanyAccess. Routes that ran assertCompanyAccess first purely to
  // surface 401-for-`none` (e.g. cockpit.ts) no longer need that ordering.
  if (req.actor.type === "none") {
    throw unauthorized();
  }
  if (req.actor.type !== "board") {
    throw forbidden("Board access required");
  }
}

/**
 * Assert the actor may access the given company. ASYNC + FAIL-CLOSED (Phase 3).
 *
 * Enforcement derives from the STATIC deployment mode via
 * `tenantIsolationEnforced()` — NOT `req.tenant?.enforced`. Reading the mutable
 * per-request tenant hint would fail OPEN whenever the tenant-context middleware
 * was skipped (e.g. a route mounted before it, or a future refactor). Closing
 * over the static primitive means a handler reached without that middleware still
 * fails CLOSED in cloud_auth.
 *
 * cloud_auth: allow iff the actor is a member of the company's owning
 * organization AND holds a company membership; operators reach tenant data ONLY
 * via a live `hasActiveBreakGlass()` check (never a cached flag). Otherwise 403.
 * self-hosted (not enforced): the pre-existing behavior — `local_implicit`
 * loopback and legacy `isInstanceAdmin` bypass preserved.
 */
export async function assertCompanyAccess(db: Db, req: Request, companyId: string): Promise<void> {
  if (req.actor.type === "none") {
    throw unauthorized();
  }
  if (req.actor.type === "board" && req.actor.source === "local_implicit") {
    return; // self-hosted loopback
  }

  if (req.actor.type === "agent") {
    if (req.actor.companyId !== companyId) {
      throw forbidden("Agent key cannot access another company");
    }
    return;
  }
  if (req.actor.type === "mcp") {
    if (req.actor.companyId !== companyId) {
      throw forbidden("MCP key cannot access another company");
    }
    return;
  }

  // board (session / board_key). Enforcement from STATIC mode — never req.tenant.
  if (!tenantIsolationEnforced()) {
    if (req.actor.isInstanceAdmin) return; // legacy self-hosted bypass
    const allowedCompanies = req.actor.companyIds ?? [];
    if (!allowedCompanies.includes(companyId)) {
      throw forbidden("User does not have access to this company");
    }
    return;
  }

  // cloud_auth: tenant + company membership; operators only via live break-glass.
  const tenantId = await resolveCompanyTenant(db, companyId);
  const orgs = req.actor.organizationIds ?? [];
  const companyIds = req.actor.companyIds ?? [];
  const memberOk = tenantId !== null && orgs.includes(tenantId) && companyIds.includes(companyId);
  if (memberOk) return;
  if (req.actor.operator && req.actor.userId && (await hasActiveBreakGlass(db, req.actor.userId, companyId))) {
    return;
  }
  // Surface the org-mismatch error when the tenant boundary is what failed; else company-scope error.
  if (tenantId !== null && !orgs.includes(tenantId)) assertTenantMembership(req, tenantId);
  throw forbidden("User does not have access to this company");
}

export function getActorInfo(req: Request) {
  if (req.actor.type === "none") {
    throw unauthorized();
  }
  if (req.actor.type === "agent") {
    return {
      actorType: "agent" as const,
      actorId: req.actor.agentId ?? "unknown-agent",
      agentId: req.actor.agentId ?? null,
      runId: req.actor.runId ?? null,
    };
  }

  if (req.actor.type === "mcp") {
    return {
      actorType: "user" as const,
      actorId: req.actor.userId ?? "mcp-user",
      agentId: null,
      runId: req.actor.runId ?? null,
    };
  }

  return {
    actorType: "user" as const,
    actorId: req.actor.userId ?? "board",
    agentId: null,
    runId: req.actor.runId ?? null,
  };
}

/**
 * Non-throwing form of {@link assertCanManageInstanceSettings} — the single
 * source of truth for "can this actor manage instance settings". This reads the
 * operator-plane field `req.actor.operator` (computed by the auth middleware from
 * instance_user_roles; middleware/auth.ts) — NOT `isInstanceAdmin`, which is
 * clamped to false in cloud_auth to neutralize the DATA-plane bypass. Reading
 * `operator` keeps the OPERATOR plane (instance-settings management) intact after
 * that clamp. The local_trusted synthetic board user (source local_implicit) is
 * always allowed.
 */
export function canManageInstanceSettings(req: Request): boolean {
  if (req.actor.type !== "board") return false;
  return req.actor.source === "local_implicit" || req.actor.operator === true;
}

export function assertCanManageInstanceSettings(req: Request): void {
  if (req.actor.type !== "board") {
    throw forbidden("Board access required");
  }
  if (canManageInstanceSettings(req)) {
    return;
  }
  throw forbidden("Instance admin access required");
}
