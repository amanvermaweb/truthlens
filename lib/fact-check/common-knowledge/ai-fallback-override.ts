import { SourceReference } from "@/lib/types";
import { CommonKnowledgeResult, ParsedClaim } from "@/lib/fact-check/pipeline/types";

const OPENAI_TIMEOUT_MS = 4500;
const OPENAI_MODEL = process.env.OPENAI_COMMON_KNOWLEDGE_MODEL ?? "gpt-5-mini";

type AiFallbackSource = {
  title?: string;
  url?: string;
  publisher?: string;
  snippet?: string;
  relation?: string;
};

type AiFallbackPayload = {
  can_resolve?: boolean;
  verdict?: string;
  confidence?: number;
  explanation?: string;
  sources?: AiFallbackSource[];
};

function parseJsonObject(raw: string) {
  const trimmed = raw.trim();

  try {
    return JSON.parse(trimmed) as AiFallbackPayload;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as AiFallbackPayload;
    } catch {
      return null;
    }
  }
}

function normalizeVerdict(value: string | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "true") {
    return "True" as const;
  }
  if (normalized === "false") {
    return "False" as const;
  }
  return null;
}

function normalizeRelation(value: string | undefined): SourceReference["relation"] {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "supports" || normalized === "support") {
    return "supports";
  }
  if (normalized === "contradicts" || normalized === "contradict") {
    return "contradicts";
  }
  return "neutral";
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timeout);
  }
}

export async function commonKnowledgeAiFallbackOverride(
  inputText: string,
  parsedClaim: ParsedClaim | null,
): Promise<CommonKnowledgeResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const structuredClaim = parsedClaim
    ? `${parsedClaim.subject} | ${parsedClaim.predicate} | ${parsedClaim.object}`
    : "none";

  const prompt = [
    "You are validating common-knowledge claims for a production fact-checking system.",
    "Only resolve if the claim is stable, objective, and broadly documented.",
    "If uncertain or controversial, return can_resolve=false.",
    "Return strict JSON with keys: can_resolve, verdict, confidence, explanation, sources.",
    "verdict must be True or False.",
    "sources must include 2-4 reputable URLs and each source must include title, url, publisher, snippet, relation.",
    "relation must be supports or contradicts.",
    "Do not invent citations.",
    `Claim: ${inputText}`,
    `Parsed claim: ${structuredClaim}`,
  ].join("\n");

  try {
    const response = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "Return only JSON. Refuse low-certainty claims with can_resolve=false. Prefer institutional and reference sources.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        response_format: {
          type: "json_object",
        },
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) {
      return null;
    }

    const parsed = parseJsonObject(raw);
    if (!parsed || parsed.can_resolve !== true) {
      return null;
    }

    const verdict = normalizeVerdict(parsed.verdict);
    const explanation = parsed.explanation?.trim();
    const sourceRows = (parsed.sources ?? []).filter((item) => {
      return (
        typeof item.title === "string" &&
        typeof item.url === "string" &&
        typeof item.publisher === "string" &&
        typeof item.snippet === "string" &&
        item.title.trim().length > 0 &&
        item.publisher.trim().length > 0 &&
        item.snippet.trim().length >= 24 &&
        isHttpUrl(item.url.trim())
      );
    });

    if (!verdict || !explanation || sourceRows.length < 2) {
      return null;
    }

    const uniqueHosts = new Set(
      sourceRows.map((item) => new URL(item.url!.trim()).hostname.toLowerCase()),
    );

    if (uniqueHosts.size < 2) {
      return null;
    }

    const sources: SourceReference[] = sourceRows.slice(0, 4).map((item, index) => {
      const relation = normalizeRelation(item.relation);
      return {
        id: `ck-ai-fallback-${index + 1}`,
        title: item.title!.trim(),
        url: item.url!.trim(),
        publisher: item.publisher!.trim(),
        snippet: item.snippet!.trim(),
        relation,
        credibility: 84,
        tier: "Tier 2",
        domainAuthorityTier: "High",
        domainAuthority: 80,
        institutionalTrust: 80,
        citationSignal: 78,
        recencyScore: 82,
        agreementScore: relation === "supports" ? 85 : relation === "contradicts" ? 86 : 70,
        relevanceScore: 90,
        finalScore: 84,
        authorityScore: 82,
      };
    });

    const confidenceInput = Number(parsed.confidence);
    const confidence = Number.isFinite(confidenceInput)
      ? Math.max(55, Math.min(89, Math.round(confidenceInput)))
      : 74;

    return {
      verdict,
      confidence,
      explanation,
      sources,
    };
  } catch {
    return null;
  }
}
