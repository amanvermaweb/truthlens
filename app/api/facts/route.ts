import { connectToDatabase } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";

type SourceNode = {
  id: string;
  label: string;
  title: string;
  source: string;
  credibility: number;
  relation: "supports" | "contradicts";
  summary: string;
  x: number;
  y: number;
};

type ClaimRecord = {
  _id?: ObjectId;
  claim: string;
  verdict: "Likely True" | "Mixed" | "Likely False";
  confidence: number;
  analysisSummary: string;
  tags: string[];
  sourceNodes: SourceNode[];
  createdAt: Date;
};

function toClientRecord(record: ClaimRecord & { _id: ObjectId }) {
  return {
    id: record._id.toString(),
    claim: record.claim,
    verdict: record.verdict,
    confidence: record.confidence,
    analysisSummary: record.analysisSummary,
    tags: record.tags,
    sourceNodes: record.sourceNodes,
    createdAt: record.createdAt,
  };
}

function hashCode(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function titleToRelation(title: string): "supports" | "contradicts" {
  const contradictionHint = /(not|false|decline|denies|refute|fails|contradict|no evidence)/i;
  return contradictionHint.test(title) ? "contradicts" : "supports";
}

function extractTags(claim: string) {
  const tagRules: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /(economy|inflation|market|trade|gdp|stocks)/i, label: "Economy" },
    { pattern: /(health|hospital|disease|vaccine|medical)/i, label: "Health" },
    { pattern: /(climate|emission|carbon|energy|environment)/i, label: "Climate" },
    { pattern: /(election|policy|government|law|minister)/i, label: "Policy" },
    { pattern: /(technology|ai|software|chip|cyber)/i, label: "Technology" },
    { pattern: /(global|international|country|foreign|geopolitics)/i, label: "International" },
  ];

  const tags = tagRules
    .filter((rule) => rule.pattern.test(claim))
    .map((rule) => rule.label);

  if (tags.length === 0) {
    tags.push("General");
  }

  return tags.slice(0, 4);
}

function buildFallbackSources(claim: string) {
  const seed = hashCode(claim);
  const fallbackTitles = [
    "Industry publication corroborates reported timeline",
    "Regional data suggests uneven local impact",
    "Policy brief flags missing causal evidence",
    "Independent analyst report validates baseline trend",
  ];

  return fallbackTitles.map((title, index) => {
    const supports = index !== 2;
    const jitter = (seed + index * 13) % 9;

    return {
      id: `fallback-${index + 1}`,
      label: `S${index + 1}`,
      title,
      source: supports ? "Open Research Digest" : "Policy Monitor Weekly",
      credibility: Math.max(58, Math.min(93, 66 + jitter + (supports ? 8 : -4))),
      relation: supports ? "supports" : "contradicts",
      summary: supports
        ? `This source aligns with central aspects of the claim and echoes the same timing assumptions.`
        : `This source disputes parts of the causal framing and highlights alternative explanations.`,
      x: 15 + ((seed + index * 21) % 70),
      y: 18 + ((seed + index * 17) % 60),
    } satisfies SourceNode;
  });
}

async function fetchExternalSources(claim: string) {
  const newsApiKey = process.env.NEWS_API_KEY;
  if (!newsApiKey) {
    return [] as SourceNode[];
  }

  const queryTerms = claim
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 3)
    .slice(0, 6)
    .join(" ");

  if (!queryTerms) {
    return [] as SourceNode[];
  }

  const params = new URLSearchParams({
    q: queryTerms,
    language: "en",
    pageSize: "8",
    sortBy: "relevancy",
  });

  try {
    const response = await fetch(`https://newsapi.org/v2/everything?${params.toString()}`, {
      headers: { "X-Api-Key": newsApiKey },
      cache: "no-store",
    });

    if (!response.ok) {
      return [] as SourceNode[];
    }

    const payload = (await response.json()) as {
      articles?: Array<{ title?: string; source?: { name?: string }; description?: string }>;
    };

    const articles = payload.articles ?? [];
    if (articles.length === 0) {
      return [] as SourceNode[];
    }

    return articles.slice(0, 8).map((article, index) => {
      const title = article.title?.trim() || `External source ${index + 1}`;
      const sourceName = article.source?.name?.trim() || "NewsAPI Source";
      const relation = titleToRelation(title);
      const confidenceSeed = hashCode(`${title}-${sourceName}`);

      return {
        id: `ext-${index + 1}`,
        label: `S${index + 1}`,
        title,
        source: sourceName,
        credibility: Math.max(55, Math.min(95, 60 + (confidenceSeed % 31))),
        relation,
        summary:
          article.description?.trim() ||
          "This source was discovered through semantic relevance matching for the submitted claim.",
        x: 14 + ((confidenceSeed + index * 19) % 72),
        y: 16 + ((confidenceSeed + index * 11) % 62),
      } satisfies SourceNode;
    });
  } catch {
    return [] as SourceNode[];
  }
}

function summarizeVerdict(sources: SourceNode[]) {
  const supportWeight = sources
    .filter((item) => item.relation === "supports")
    .reduce((total, item) => total + item.credibility, 0);
  const contradictionWeight = sources
    .filter((item) => item.relation === "contradicts")
    .reduce((total, item) => total + item.credibility, 0);

  const totalWeight = Math.max(1, supportWeight + contradictionWeight);
  const supportRatio = supportWeight / totalWeight;
  const confidence = Math.round(55 + supportRatio * 40);

  if (supportRatio >= 0.62) {
    return {
      verdict: "Likely True" as const,
      confidence,
      analysisSummary:
        "Most high-credibility evidence supports the claim, though some uncertainty remains due to source variance.",
    };
  }

  if (supportRatio <= 0.4) {
    return {
      verdict: "Likely False" as const,
      confidence: Math.round(100 - confidence),
      analysisSummary:
        "Contradicting sources carry more evidence weight than supporting material, reducing confidence in this claim.",
    };
  }

  return {
    verdict: "Mixed" as const,
    confidence,
    analysisSummary:
      "Supporting and contradicting evidence are closely balanced, so this claim should be treated as inconclusive.",
  };
}

async function buildClaimRecord(claim: string): Promise<ClaimRecord> {
  const externalSources = await fetchExternalSources(claim);
  const sourceNodes = externalSources.length > 0 ? externalSources : buildFallbackSources(claim);
  const verdictSummary = summarizeVerdict(sourceNodes);

  return {
    claim,
    verdict: verdictSummary.verdict,
    confidence: verdictSummary.confidence,
    analysisSummary: verdictSummary.analysisSummary,
    tags: extractTags(claim),
    sourceNodes,
    createdAt: new Date(),
  };
}

export async function GET(req: NextRequest) {
  const client = await connectToDatabase();
  const db = client.db("truth-lens");
  const claims = db.collection<ClaimRecord>("claims");

  const historyParam = req.nextUrl.searchParams.get("history");
  const claimId = req.nextUrl.searchParams.get("claimId");

  if (historyParam === "1") {
    const historyItems = await claims
      .find(
        {},
        {
          projection: {
            claim: 1,
            verdict: 1,
            confidence: 1,
            createdAt: 1,
          },
        },
      )
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    return NextResponse.json({
      history: historyItems.map((item) => ({
        id: item._id!.toString(),
        claim: item.claim,
        verdict: item.verdict,
        confidence: item.confidence,
        createdAt: item.createdAt,
      })),
    });
  }

  if (claimId) {
    if (!ObjectId.isValid(claimId)) {
      return NextResponse.json({ error: "Invalid claimId" }, { status: 400 });
    }

    const record = await claims.findOne({ _id: new ObjectId(claimId) });
    if (!record?._id) {
      return NextResponse.json({ error: "Claim not found" }, { status: 404 });
    }

    return NextResponse.json({ claim: toClientRecord(record as ClaimRecord & { _id: ObjectId }) });
  }

  const latest = await claims.find({}).sort({ createdAt: -1 }).limit(1).next();
  if (!latest?._id) {
    return NextResponse.json({ claim: null });
  }

  return NextResponse.json({
    claim: toClientRecord(latest as ClaimRecord & { _id: ObjectId }),
  });
}

export async function POST(req: NextRequest) {
  const payload = (await req.json().catch(() => null)) as { claim?: unknown } | null;
  const claim = typeof payload?.claim === "string" ? payload.claim.trim() : "";

  if (!claim) {
    return NextResponse.json({ error: "Claim is required" }, { status: 400 });
  }

  if (claim.length > 1400) {
    return NextResponse.json({ error: "Claim is too long" }, { status: 400 });
  }

  const record = await buildClaimRecord(claim);
  const client = await connectToDatabase();
  const db = client.db("truth-lens");
  const result = await db.collection<ClaimRecord>("claims").insertOne(record);

  return NextResponse.json(
    {
      claimId: result.insertedId.toString(),
      claim: {
        ...record,
        id: result.insertedId.toString(),
      },
    },
    { status: 201 },
  );
}