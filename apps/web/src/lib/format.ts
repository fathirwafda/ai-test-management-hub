export { formatPercent } from "@hub/shared";

export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "–";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s % 60)} s`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const TESTER_KEY = "hub.testerName";

/** The tester name is a per-browser convenience (there is no login); storage may be unavailable. */
export function getTesterName(): string {
  try {
    return localStorage.getItem(TESTER_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setTesterName(name: string): void {
  try {
    localStorage.setItem(TESTER_KEY, name);
  } catch {
    // ignore: private mode or blocked storage
  }
}
