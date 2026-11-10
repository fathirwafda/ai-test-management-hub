import type { Db } from "../db/database.js";

export interface Clock {
  now(): string;
}

export const systemClock: Clock = { now: () => new Date().toISOString() };

export interface RepoContext {
  db: Db;
  clock: Clock;
}

export function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Canonical form of an automation reference, so "Cart › adds item" and "cart > adds  item" match. */
export function normalizeRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const norm = ref
    .replace(/\\/g, "/")
    .replace(/[›»]/g, ">")
    .replace(/::/g, "#")
    .replace(/\s*([>#])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return norm || null;
}
