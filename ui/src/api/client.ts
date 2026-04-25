const BASE = "/api";

export interface ApiFieldError {
  field: string;
  id: string;
  message: string;
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  /**
   * If this is a 422 with a `{ details: { field, id } }` body (the shape the
   * server emits when an FK reference is invalid), return the field/id/message
   * tuple so callers can render an inline error against the offending input.
   */
  get fieldError(): ApiFieldError | null {
    if (this.status !== 422) return null;
    const body = this.body;
    if (!body || typeof body !== "object") return null;
    const details = (body as { details?: unknown }).details;
    if (!details || typeof details !== "object") return null;
    const { field, id } = details as { field?: unknown; id?: unknown };
    if (typeof field !== "string" || typeof id !== "string") return null;
    return { field, id, message: this.message };
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? undefined);
  const body = init?.body;
  if (!(body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${BASE}${path}`, {
    headers,
    credentials: "include",
    ...init,
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    throw new ApiError(
      (errorBody as { error?: string } | null)?.error ?? `Request failed: ${res.status}`,
      res.status,
      errorBody,
    );
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  postForm: <T>(path: string, body: FormData) =>
    request<T>(path, { method: "POST", body }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
