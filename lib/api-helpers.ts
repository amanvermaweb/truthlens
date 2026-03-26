import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function getOptionalUserId() {
  try {
    const session = await auth();
    return session.userId ?? undefined;
  } catch {
    return undefined;
  }
}

export async function readJsonBody<T>(request: Request): Promise<T | null> {
  return (await request.json().catch(() => null)) as T | null;
}

export function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function parsePositiveInteger(
  value: string | null,
  fallback: number,
  options: { min: number; max: number },
) {
  const parsed = Number.parseInt(value ?? `${fallback}`, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(options.max, Math.max(options.min, parsed));
}
