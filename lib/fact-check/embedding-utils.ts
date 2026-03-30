import { hashValue, tokenize } from "@/lib/fact-check/claim-utils";

const EMBEDDING_DIMENSIONS = 256;
const EMBEDDING_REQUEST_TIMEOUT_MS = 3000;

export function getEmbedding(text: string): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  const tokens = tokenize(text);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const hash = hashValue(`${token}:${index}`);
    const slot = Number.parseInt(hash.slice(0, 8), 16) % EMBEDDING_DIMENSIONS;
    const sign = Number.parseInt(hash.slice(8, 10), 16) % 2 === 0 ? 1 : -1;
    vector[slot] += sign;
  }

  return normalizeVector(vector);
}

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMBEDDING_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOpenAIEmbeddings(texts: string[]): Promise<number[][] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || texts.length === 0) {
    return null;
  }

  try {
    const response = await fetchWithTimeout("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
        input: texts,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };

    const embeddings = payload.data?.map((item) => item.embedding ?? []);
    if (!embeddings || embeddings.length !== texts.length) {
      return null;
    }

    return embeddings.map(normalizeVector);
  } catch {
    return null;
  }
}

function normalizeVector(vector: number[]) {
  const norm = Math.sqrt(vector.reduce((acc, value) => acc + value * value, 0));
  if (norm === 0) {
    return vector;
  }

  return vector.map((value) => value / norm);
}

export async function getEmbeddings(texts: string[]) {
  const openAIEmbeddings = await fetchOpenAIEmbeddings(texts);
  if (openAIEmbeddings) {
    return openAIEmbeddings;
  }

  return texts.map(getEmbedding);
}

export function cosineSimilarity(a: number[], b: number[]) {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;

  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    aNorm += a[index] * a[index];
    bNorm += b[index] * b[index];
  }

  const denom = Math.sqrt(aNorm) * Math.sqrt(bNorm);
  return denom === 0 ? 0 : dot / denom;
}
