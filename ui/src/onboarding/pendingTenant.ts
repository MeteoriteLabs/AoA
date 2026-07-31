export type PendingTenant = { id: string; name: string };

export function pendingTenantKey(userId: string): string {
  return `aoa.onboarding.pendingTenant.${userId}`;
}

export function readPendingTenant(userId: string): PendingTenant | null {
  try {
    const raw = localStorage.getItem(pendingTenantKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingTenant>;
    return typeof parsed.id === "string" && typeof parsed.name === "string"
      ? { id: parsed.id, name: parsed.name }
      : null;
  } catch {
    return null;
  }
}

export function writePendingTenant(userId: string, tenant: PendingTenant): void {
  try {
    localStorage.setItem(pendingTenantKey(userId), JSON.stringify(tenant));
  } catch {
    // Same-page retries still use CreateOrganizationStep's in-memory ref when
    // storage is unavailable.
  }
}

export function clearPendingTenant(userId: string): void {
  try {
    localStorage.removeItem(pendingTenantKey(userId));
  } catch {
    // A stale recovery hint is harmless: re-adopting the same org id is idempotent.
  }
}
