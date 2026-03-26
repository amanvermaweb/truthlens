import { InputPayload } from "@/lib/types";

export type ParsedClaim = {
  subject: string;
  predicate: string;
  object: string;
};

const MAX_INPUT_LENGTH = 1400;

export function parseInputPayload(payload: InputPayload | null) {
  const inputCandidate =
    typeof payload?.input === "string"
      ? payload.input
      : typeof payload?.claim === "string"
        ? payload.claim
        : typeof payload?.url === "string"
          ? payload.url
          : "";

  const input = inputCandidate.trim();
  if (!input) {
    return { error: "Input is required" as const };
  }

  if (input.length > MAX_INPUT_LENGTH) {
    return { error: "Input is too long" as const };
  }

  return { input };
}

export function normalizeInput(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function getInputType(input: string): "text" | "url" {
  try {
    const parsed = new URL(input);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? "url" : "text";
  } catch {
    return "text";
  }
}

export function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function tokenize(input: string) {
  const stopwords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "of",
    "to",
    "and",
    "in",
    "on",
    "for",
    "with",
    "very",
    "really",
  ]);

  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stopwords.has(token));
}

export function parseClaimStructure(input: string): ParsedClaim | null {
  const cleaned = input.trim().replace(/\s+/g, " ");
  const pattern = /^(.+?)\s+(is|are|was|were|has|have|can|cannot|can't|will|won't)\s+(.+?)\.?$/i;
  const match = cleaned.match(pattern);

  if (!match) {
    return null;
  }

  const subject = match[1].trim();
  const predicate = match[2].trim().toLowerCase();
  const object = match[3].trim();

  if (subject.length < 2 || object.length < 2) {
    return null;
  }

  return { subject, predicate, object };
}

export function extractEntityCandidate(input: string) {
  const parsed = parseClaimStructure(input);
  if (parsed) {
    return parsed.subject;
  }

  const titleCaseMatch = input.match(/([A-Z][a-z]+\s+[A-Z][a-z]+)/);
  if (titleCaseMatch?.[1]) {
    return titleCaseMatch[1];
  }

  return input.split(/\s+/).slice(0, 4).join(" ").trim();
}

export function isBlockedUrl(input: string) {
  try {
    const parsed = new URL(input);
    const host = parsed.hostname.toLowerCase();

    if (["localhost", "127.0.0.1", "::1"].includes(host)) {
      return true;
    }

    if (host.startsWith("10.") || host.startsWith("192.168.")) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
