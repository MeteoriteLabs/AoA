const BUILD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function templateNames(row) {
  return [...(Array.isArray(row?.names) ? row.names : []), ...(Array.isArray(row?.aliases) ? row.aliases : [])];
}

export function selectE2bTemplateIdentity(requestedTemplate, templates) {
  const requested = String(requestedTemplate ?? "").trim();
  const matches = (Array.isArray(templates) ? templates : []).filter((row) =>
    row?.templateID === requested || templateNames(row).some((name) => name === requested || name.endsWith(`/${requested}`)),
  );
  if (matches.length === 0) throw new Error(`E2B template identity: could not resolve ${JSON.stringify(requested)}`);
  if (matches.length !== 1) throw new Error(`E2B template identity: ${JSON.stringify(requested)} is ambiguous (${matches.length} matches)`);
  const row = matches[0];
  if (typeof row.templateID !== "string" || row.templateID.length === 0) throw new Error("E2B template identity: missing template ID");
  if (!BUILD_ID_RE.test(String(row.buildID ?? ""))) throw new Error("E2B template identity: missing or malformed immutable build ID");
  if (row.buildStatus !== "ready") throw new Error(`E2B template identity: current build is not ready (${JSON.stringify(row.buildStatus)})`);
  return {
    requestedTemplate: requested,
    templateId: row.templateID,
    buildId: row.buildID,
    buildStatus: row.buildStatus,
    envdVersion: typeof row.envdVersion === "string" ? row.envdVersion : null,
  };
}

export function evaluateE2bSandboxBuildBinding(sandboxId, expected, events) {
  const matching = (Array.isArray(events) ? events : []).filter((event) => event?.sandboxId === sandboxId);
  const violations = [];
  if (matching.length === 0) violations.push(`no provider event binds sandbox ${sandboxId} to a template build`);
  if (matching.some((event) => event.sandboxTemplateId !== expected.templateId)) {
    violations.push(`sandbox ${sandboxId} does not bind to expected template ${expected.templateId}`);
  }
  if (matching.some((event) => event.sandboxBuildId !== expected.buildId)) {
    violations.push(`sandbox ${sandboxId} does not bind to expected build ${expected.buildId}`);
  }
  return { pass: violations.length === 0, violations };
}

async function apiResponse(fetchFn, url, apiKey) {
  const response = await fetchFn(url, { headers: { "X-API-Key": apiKey, Accept: "application/json" } });
  if (!response?.ok) throw new Error(`E2B identity API ${new URL(url).pathname} returned HTTP ${response?.status ?? "unknown"}`);
  return response;
}

export async function resolveE2bTemplateIdentity({ fetchFn = fetch, apiUrl = "https://api.e2b.dev", apiKey, requestedTemplate }) {
  if (!apiKey) throw new Error("E2B template identity: API key is required");
  const rows = [];
  let nextToken = null;
  do {
    const query = new URLSearchParams({ limit: "100" });
    if (nextToken) query.set("nextToken", nextToken);
    const response = await apiResponse(fetchFn, `${apiUrl}/v2/templates?${query}`, apiKey);
    rows.push(...await response.json());
    nextToken = response.headers?.get?.("X-Next-Token") || null;
  } while (nextToken);
  return selectE2bTemplateIdentity(requestedTemplate, rows);
}

export async function readE2bSandboxBuildBinding({ fetchFn = fetch, apiUrl = "https://api.e2b.dev", apiKey, sandboxId, expected }) {
  const response = await apiResponse(fetchFn, `${apiUrl}/events/sandboxes/${encodeURIComponent(sandboxId)}?limit=100&orderAsc=true`, apiKey);
  const events = await response.json();
  return { events, verdict: evaluateE2bSandboxBuildBinding(sandboxId, expected, events) };
}
