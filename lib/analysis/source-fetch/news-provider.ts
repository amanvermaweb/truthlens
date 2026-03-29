import { SourceReference } from "@/lib/types";

import { ParsedClaim } from "@/lib/analysis/input";
import {
  computeAgreementScore,
  computeEvidenceQuality,
  computeTrustScore,
  evaluateRelation,
  fetchWithTimeout,
} from "@/lib/analysis/source-fetch/shared";

export async function fetchNewsSources(
  queryText: string,
  parsedClaim: ParsedClaim | null,
): Promise<{ sources: SourceReference[]; failures: string[] }> {
  const failures: string[] = [];
  const key = process.env.NEWSAPI;

  if (!key) {
    failures.push("NEWSAPI key not configured.");
    return { sources: [], failures };
  }

  const queryTerms = queryText
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 3)
    .slice(0, 8)
    .join(" ");

  if (!queryTerms) {
    failures.push("Insufficient query terms for external lookup.");
    return { sources: [], failures };
  }

  const params = new URLSearchParams({
    q: queryTerms,
    pageSize: "8",
    language: "en",
    sortBy: "relevancy",
  });

  try {
    const response = await fetchWithTimeout(
      `https://newsapi.org/v2/everything?${params.toString()}`,
      {
        headers: {
          "X-Api-Key": key,
        },
      },
    );

    if (!response.ok) {
      failures.push(`News API failed with status ${response.status}.`);
      return { sources: [], failures };
    }

    const payload = (await response.json()) as {
      articles?: Array<{
        title?: string;
        url?: string;
        description?: string;
        source?: { name?: string };
      }>;
    };

    const articles = payload.articles ?? [];
    const sources = articles.slice(0, 8).map((article, index) => {
      const title = article.title?.trim() || `External evidence ${index + 1}`;
      const description = article.description?.trim() || "No summary available from provider.";
      const publisher = article.source?.name?.trim() || "NewsAPI";
      const relation = evaluateRelation(queryText, parsedClaim, `${title} ${description}`);
      const url = article.url?.trim() || "";
      const trust = computeTrustScore(url, publisher);
      const quality = computeEvidenceQuality(title, description);
      const agreement = computeAgreementScore(relation);

      return {
        id: `news-${index + 1}`,
        title,
        url,
        publisher,
        snippet: description,
        relation,
        credibility: Math.round((trust * 0.5 + quality * 0.25 + agreement * 0.25) * 100),
      } satisfies SourceReference;
    });

    return { sources: sources.filter((source) => source.url.length > 0), failures };
  } catch {
    failures.push("News API request timed out or failed.");
    return { sources: [], failures };
  }
}
