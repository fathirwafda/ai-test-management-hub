export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
    throw new ApiError(res.status, body.error ?? res.statusText, body.details);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: body === undefined ? {} : { "content-type": "application/json" },
  body: body === undefined ? null : JSON.stringify(body),
});

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, json("POST", body ?? {})),
  patch: <T>(path: string, body: unknown) => request<T>(path, json("PATCH", body)),
  delete: (path: string) => request<void>(path, { method: "DELETE" }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form }),
};

/** Turns an error into one readable line, including zod issue paths from the API. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (Array.isArray(err.details) && err.details.length) {
      const issues = (err.details as unknown[])
        .slice(0, 3)
        .map((d) =>
          typeof d === "string"
            ? d
            : `${(d as { path?: string }).path || "input"}: ${(d as { message?: string }).message ?? ""}`,
        );
      return `${err.message}: ${issues.join("; ")}`;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

export function toQuery(params: Record<string, string | number | boolean | string[] | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      if (v.length) q.set(k, v.join(","));
    } else q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}
