export const ADAPTER_PROBE_RETRY_AFTER_SECONDS = 30;
export const ADAPTER_PROBE_BUSY_ERROR =
  "A connection test is already running for this company. Please wait for it to finish and retry.";

// Adapter probes can spawn a local CLI for tens of seconds. Keep one shared,
// in-process slot per company across every route that starts a probe. A
// multi-instance deployment would need a distributed lock instead.
const companiesWithProbeInFlight = new Set<string>();

export function tryAcquireAdapterProbeSlot(companyId: string): (() => void) | null {
  if (companiesWithProbeInFlight.has(companyId)) return null;

  companiesWithProbeInFlight.add(companyId);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    companiesWithProbeInFlight.delete(companyId);
  };
}
