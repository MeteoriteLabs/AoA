export type PendingOrganization = { id: string; name: string };

export function pendingOrganizationKey(userId: string): string {
  return `aoa.onboarding.pendingOrganization.${userId}`;
}

export function readPendingOrganization(userId: string): PendingOrganization | null {
  try {
    const raw = localStorage.getItem(pendingOrganizationKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingOrganization>;
    return typeof parsed.id === "string" && typeof parsed.name === "string"
      ? { id: parsed.id, name: parsed.name }
      : null;
  } catch {
    return null;
  }
}

export function writePendingOrganization(
  userId: string,
  company: PendingOrganization,
): void {
  try {
    localStorage.setItem(pendingOrganizationKey(userId), JSON.stringify(company));
  } catch {
    // Same-page retries still use OrgStep's in-memory ref when storage is unavailable.
  }
}

export function clearPendingOrganization(userId: string): void {
  try {
    localStorage.removeItem(pendingOrganizationKey(userId));
  } catch {
    // A stale recovery hint is harmless: replaying the advance is idempotent.
  }
}
