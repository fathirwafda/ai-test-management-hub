import type { z } from "zod";

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);
export const conflict = (message: string) => new HttpError(409, message);
export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);

/** Validates request input; a failure becomes a 400 with the zod issues as details. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw badRequest(
      "Validation failed",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}

export function idParam(value: unknown, name = "id"): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${name} must be a positive integer`);
  return n;
}
