import { describe, expect, it } from "vitest";

import { scoreEvidence } from "./scoring";
import { SourceReference } from "../types";

function source(partial: Partial<SourceReference>): SourceReference {
  return {
    id: partial.id ?? "src-1",
    title: partial.title ?? "Source title",
    url: partial.url ?? "https://example.com/article",
    publisher: partial.publisher ?? "Example News",
    snippet: partial.snippet ?? "Source snippet",
    relation: partial.relation ?? "neutral",
    credibility: partial.credibility ?? 70,
  };
}

describe("scoreEvidence regression coverage", () => {
  it("does not return high-confidence true on sparse nonsense evidence", () => {
    const claim = "The moon is made of cheese";

    const result = scoreEvidence(
      [
        source({
          id: "blog-1",
          title: "Why moon cheese theory is real",
          url: "https://medium.com/@writer/moon-cheese",
          publisher: "Personal Blog",
          relation: "supports",
          credibility: 96,
          snippet: "Opinion post with no verifiable data.",
        }),
      ],
      claim,
    );

    expect(result.verdict).toBe("Unknown");
    expect(result.confidence).toBeLessThanOrEqual(55);
  });

  it("prioritizes government and research over blogs in aggregate scoring", () => {
    const claim = "India has the highest GDP in the world";

    const result = scoreEvidence(
      [
        source({
          id: "blog-1",
          url: "https://medium.com/@random/hottest-gdp-take",
          publisher: "Random Blog",
          relation: "supports",
          credibility: 95,
          snippet: "Unverified ranking claim.",
        }),
        source({
          id: "blog-2",
          url: "https://mynews.wordpress.com/gdp-ranking",
          publisher: "Opinion Blog",
          relation: "supports",
          credibility: 95,
          snippet: "No primary data attached.",
        }),
        source({
          id: "gov-1",
          url: "https://data.worldbank.org/indicator/NY.GDP.MKTP.CD",
          publisher: "World Bank",
          relation: "contradicts",
          credibility: 78,
          snippet: "Official GDP table lists a different country at rank 1.",
        }),
        source({
          id: "res-1",
          url: "https://doi.org/10.1000/example-gdp-study",
          publisher: "Economic Research Journal",
          relation: "contradicts",
          credibility: 78,
          snippet: "Peer-reviewed dataset confirms the top economy is not India.",
        }),
      ],
      claim,
    );

    expect(result.verdict).not.toBe("True");
    expect(result.contradictionWeight).toBeGreaterThan(result.supportWeight);
  });

  it("requires independent publishers before confident false verdicts", () => {
    const claim = "Elon Musk is very poor";

    const result = scoreEvidence(
      [
        source({
          id: "single-pub-1",
          url: "https://example.com/report-1",
          publisher: "Single Source Daily",
          relation: "contradicts",
          credibility: 92,
          snippet: "Net worth estimates place him among richest individuals.",
        }),
        source({
          id: "single-pub-2",
          url: "https://example.com/report-2",
          publisher: "Single Source Daily",
          relation: "contradicts",
          credibility: 90,
          snippet: "Market data shows billions in equity value.",
        }),
      ],
      claim,
    );

    expect(result.verdict).toBe("Unknown");
    expect(result.confidence).toBeLessThanOrEqual(54);
  });
});
