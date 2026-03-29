import { ParsedClaim } from "@/lib/analysis/input";
import { SourceReference } from "@/lib/types";

import {
  fetchInstitutionalApiSources,
  fetchNewsSources,
  fetchWikipediaAndWikidataSources,
  resolveInputText,
} from "@/lib/analysis/source-fetch/index";

export { resolveInputText };

export async function fetchAllSources(
  queryText: string,
  parsedClaim: ParsedClaim | null,
): Promise<{ sources: SourceReference[]; failures: string[] }> {
  const [newsData, groundingData, institutionalData] = await Promise.all([
    fetchNewsSources(queryText, parsedClaim),
    fetchWikipediaAndWikidataSources(queryText, parsedClaim),
    fetchInstitutionalApiSources(queryText, parsedClaim),
  ]);

  return {
    sources: [...groundingData.sources, ...institutionalData.sources, ...newsData.sources],
    failures: [...groundingData.failures, ...institutionalData.failures, ...newsData.failures],
  };
}
