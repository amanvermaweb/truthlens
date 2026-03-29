import { SourceReference } from "@/lib/types";

import {
  extractEntityCandidate,
  ParsedClaim,
} from "@/lib/analysis/input";
import {
  computeAgreementScore,
  computeEvidenceQuality,
  computeTrustScore,
  evaluateRelation,
  fetchWithTimeout,
  hashValue,
} from "@/lib/analysis/source-fetch/shared";

export async function fetchWikipediaAndWikidataSources(
  queryText: string,
  parsedClaim: ParsedClaim | null,
): Promise<{ sources: SourceReference[]; failures: string[] }> {
  const failures: string[] = [];
  const search = encodeURIComponent(extractEntityCandidate(queryText));

  try {
    const wikiSearchResponse = await fetchWithTimeout(
      `https://en.wikipedia.org/w/api.php?action=opensearch&search=${search}&limit=1&namespace=0&format=json`,
    );

    if (!wikiSearchResponse.ok) {
      failures.push(`Wikipedia search failed with status ${wikiSearchResponse.status}.`);
      return { sources: [], failures };
    }

    const wikiSearch = (await wikiSearchResponse.json()) as [string, string[], string[], string[]];
    const wikiTitle = wikiSearch[1]?.[0];
    if (!wikiTitle) {
      failures.push("Wikipedia returned no matching entity.");
      return { sources: [], failures };
    }

    const summaryResponse = await fetchWithTimeout(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`,
    );
    if (!summaryResponse.ok) {
      failures.push(`Wikipedia summary failed with status ${summaryResponse.status}.`);
      return { sources: [], failures };
    }

    const summary = (await summaryResponse.json()) as {
      title?: string;
      extract?: string;
      content_urls?: { desktop?: { page?: string } };
    };

    const wikiSnippet = summary.extract?.trim() || "No summary provided.";
    const wikiUrl =
      summary.content_urls?.desktop?.page ||
      `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle)}`;
    const wikiRelation = evaluateRelation(
      queryText,
      parsedClaim,
      `${summary.title ?? ""} ${wikiSnippet}`,
    );
    const wikiTrust = computeTrustScore(wikiUrl, "Wikipedia");
    const wikiQuality = computeEvidenceQuality(summary.title ?? wikiTitle, wikiSnippet);
    const wikiAgreement = computeAgreementScore(wikiRelation);

    const sources: SourceReference[] = [
      {
        id: `wikipedia-${hashValue(wikiTitle).slice(0, 8)}`,
        title: summary.title?.trim() || wikiTitle,
        url: wikiUrl,
        publisher: "Wikipedia",
        snippet: wikiSnippet,
        relation: wikiRelation,
        credibility: Math.round(
          (wikiTrust * 0.5 + wikiQuality * 0.25 + wikiAgreement * 0.25) * 100,
        ),
      },
    ];

    try {
      const wikidataSearchResponse = await fetchWithTimeout(
        `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${search}&language=en&format=json&limit=1&type=item`,
      );

      if (!wikidataSearchResponse.ok) {
        failures.push(`Wikidata search failed with status ${wikidataSearchResponse.status}.`);
        return { sources, failures };
      }

      const wikidataSearch = (await wikidataSearchResponse.json()) as {
        search?: Array<{ id?: string; label?: string; description?: string }>;
      };

      const firstEntity = wikidataSearch.search?.[0];
      if (firstEntity?.id) {
        const description = firstEntity.description?.trim() || "No description from Wikidata.";
        const wikidataUrl = `https://www.wikidata.org/wiki/${firstEntity.id}`;
        const wikidataRelation = evaluateRelation(
          queryText,
          parsedClaim,
          `${firstEntity.label ?? ""} ${description}`,
        );
        const wikidataTrust = computeTrustScore(wikidataUrl, "Wikidata");
        const wikidataQuality = computeEvidenceQuality(
          firstEntity.label ?? "Wikidata entity",
          description,
        );
        const wikidataAgreement = computeAgreementScore(wikidataRelation);

        sources.push({
          id: `wikidata-${firstEntity.id}`,
          title: firstEntity.label?.trim() || firstEntity.id,
          url: wikidataUrl,
          publisher: "Wikidata",
          snippet: description,
          relation: wikidataRelation,
          credibility: Math.round(
            (wikidataTrust * 0.5 + wikidataQuality * 0.25 + wikidataAgreement * 0.25) * 100,
          ),
        });
      } else {
        failures.push("Wikidata returned no matching entity.");
      }
    } catch {
      failures.push("Wikidata request timed out or failed.");
    }

    return { sources, failures };
  } catch {
    failures.push("Wikipedia request timed out or failed.");
    return { sources: [], failures };
  }
}
