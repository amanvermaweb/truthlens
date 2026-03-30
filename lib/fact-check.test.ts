import { beforeAll, describe, expect, it, vi } from "vitest";

import { SourceReference } from "./types";

vi.mock("@/lib/mongodb", () => ({
  connectToDatabase: vi.fn(),
}));

let scoreEvidence: (typeof import("./fact-check"))["__testHooks"]["scoreEvidence"];
let commonKnowledgeCeoOverride: (typeof import("./fact-check"))["__testHooks"]["commonKnowledgeCeoOverride"];
let commonKnowledgeFounderOverride: (typeof import("./fact-check"))["__testHooks"]["commonKnowledgeFounderOverride"];
let commonKnowledgePrimeMinisterOverride: (typeof import("./fact-check"))["__testHooks"]["commonKnowledgePrimeMinisterOverride"];
let commonKnowledgeHeadquartersOverride: (typeof import("./fact-check"))["__testHooks"]["commonKnowledgeHeadquartersOverride"];
let commonKnowledgeBornInOverride: (typeof import("./fact-check"))["__testHooks"]["commonKnowledgeBornInOverride"];
let commonKnowledgeDiedInOverride: (typeof import("./fact-check"))["__testHooks"]["commonKnowledgeDiedInOverride"];
let commonKnowledgeSpouseOverride: (typeof import("./fact-check"))["__testHooks"]["commonKnowledgeSpouseOverride"];
let commonKnowledgeLifeStatusOverride: (typeof import("./fact-check"))["__testHooks"]["commonKnowledgeLifeStatusOverride"];
let commonKnowledgeOrbitOverride: (typeof import("./fact-check"))["__testHooks"]["commonKnowledgeOrbitOverride"];
let commonKnowledgeScienceIsAOverride: (typeof import("./fact-check"))["__testHooks"]["commonKnowledgeScienceIsAOverride"];
let commonKnowledgeAtomicNumberOverride: (typeof import("./fact-check"))["__testHooks"]["commonKnowledgeAtomicNumberOverride"];
let commonKnowledgeBoilingPointOverride: (typeof import("./fact-check"))["__testHooks"]["commonKnowledgeBoilingPointOverride"];
let commonKnowledgeUltraBasicOverride: (typeof import("./fact-check"))["__testHooks"]["commonKnowledgeUltraBasicOverride"];
let commonKnowledgeCapitalOverride: (typeof import("./fact-check"))["__testHooks"]["commonKnowledgeCapitalOverride"];
let commonKnowledgeAiFallbackOverride: (typeof import("./fact-check"))["__testHooks"]["commonKnowledgeAiFallbackOverride"];

beforeAll(async () => {
  const factCheckModule = await import("./fact-check");
  scoreEvidence = factCheckModule.__testHooks.scoreEvidence;
  commonKnowledgeCeoOverride = factCheckModule.__testHooks.commonKnowledgeCeoOverride;
  commonKnowledgeFounderOverride = factCheckModule.__testHooks.commonKnowledgeFounderOverride;
  commonKnowledgePrimeMinisterOverride = factCheckModule.__testHooks.commonKnowledgePrimeMinisterOverride;
  commonKnowledgeHeadquartersOverride = factCheckModule.__testHooks.commonKnowledgeHeadquartersOverride;
  commonKnowledgeBornInOverride = factCheckModule.__testHooks.commonKnowledgeBornInOverride;
  commonKnowledgeDiedInOverride = factCheckModule.__testHooks.commonKnowledgeDiedInOverride;
  commonKnowledgeSpouseOverride = factCheckModule.__testHooks.commonKnowledgeSpouseOverride;
  commonKnowledgeLifeStatusOverride = factCheckModule.__testHooks.commonKnowledgeLifeStatusOverride;
  commonKnowledgeOrbitOverride = factCheckModule.__testHooks.commonKnowledgeOrbitOverride;
  commonKnowledgeScienceIsAOverride = factCheckModule.__testHooks.commonKnowledgeScienceIsAOverride;
  commonKnowledgeAtomicNumberOverride = factCheckModule.__testHooks.commonKnowledgeAtomicNumberOverride;
  commonKnowledgeBoilingPointOverride = factCheckModule.__testHooks.commonKnowledgeBoilingPointOverride;
  commonKnowledgeUltraBasicOverride = factCheckModule.__testHooks.commonKnowledgeUltraBasicOverride;
  commonKnowledgeCapitalOverride = factCheckModule.__testHooks.commonKnowledgeCapitalOverride;
  commonKnowledgeAiFallbackOverride = factCheckModule.__testHooks.commonKnowledgeAiFallbackOverride;
});

function source(partial: Partial<SourceReference>): SourceReference {
  return {
    id: partial.id ?? "src-1",
    title: partial.title ?? "Source title",
    url: partial.url ?? "https://example.com/article",
    publisher: partial.publisher ?? "Example News",
    snippet: partial.snippet ?? "Source snippet",
    relation: partial.relation ?? "neutral",
    credibility: partial.credibility ?? 70,
    relevanceScore: partial.relevanceScore ?? 70,
    authorityScore: partial.authorityScore ?? 70,
    finalScore: partial.finalScore ?? 70,
  };
}

describe("fact-check scoring regressions", () => {
  it("resolves CEO role claims via common-knowledge override", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ search: [{ id: "Q24283660", label: "OpenAI" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q24283660: {
                claims: {
                  P169: [
                    {
                      rank: "normal",
                      mainsnak: { datavalue: { value: { id: "Q57753" } } },
                    },
                  ],
                },
                labels: { en: { value: "OpenAI" } },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q57753: {
                labels: { en: { value: "Sam Altman" } },
              },
            },
          }),
          { status: 200 },
        ),
      );

    const result = await commonKnowledgeCeoOverride(
      "Sam Altman is the CEO of OpenAI",
      { subject: "Sam Altman", predicate: "is", object: "the CEO of OpenAI" },
    );

    expect(result?.verdict).toBe("True");
    expect(result?.confidence).toBeGreaterThanOrEqual(90);
    expect(result?.sources.length).toBeGreaterThanOrEqual(1);

    fetchMock.mockRestore();
  });

  it("resolves capital claims via Wikidata-backed common-knowledge override", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ search: [{ id: "Q668", label: "India" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q668: {
                claims: {
                  P36: [
                    {
                      rank: "normal",
                      mainsnak: { datavalue: { value: { id: "Q987" } } },
                    },
                  ],
                },
                labels: { en: { value: "India" } },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q987: {
                labels: { en: { value: "New Delhi" } },
              },
            },
          }),
          { status: 200 },
        ),
      );

    const result = await commonKnowledgeCapitalOverride(
      "The capital of India is New Delhi",
      { subject: "capital of India", predicate: "is", object: "New Delhi" },
    );

    expect(result?.verdict).toBe("True");
    expect(result?.confidence).toBeGreaterThanOrEqual(90);

    fetchMock.mockRestore();
  });

  it("contradicts incorrect capital claims via Wikidata-backed common-knowledge override", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ search: [{ id: "Q142", label: "France" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q142: {
                claims: {
                  P36: [
                    {
                      rank: "normal",
                      mainsnak: { datavalue: { value: { id: "Q90" } } },
                    },
                  ],
                },
                labels: { en: { value: "France" } },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q90: {
                labels: { en: { value: "Paris" } },
              },
            },
          }),
          { status: 200 },
        ),
      );

    const result = await commonKnowledgeCapitalOverride(
      "The capital of France is Marseille",
      { subject: "capital of France", predicate: "is", object: "Marseille" },
    );

    expect(result?.verdict).toBe("False");
    expect(result?.confidence).toBeGreaterThanOrEqual(90);

    fetchMock.mockRestore();
  });

  it("uses AI fallback only when response includes diverse valid citations", async () => {
    const originalApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    can_resolve: true,
                    verdict: "True",
                    confidence: 95,
                    explanation: "Reference sources consistently describe Canberra as Australia's capital.",
                    sources: [
                      {
                        title: "Australia - World Factbook",
                        url: "https://www.cia.gov/the-world-factbook/countries/australia/",
                        publisher: "CIA World Factbook",
                        snippet: "The capital of Australia is Canberra.",
                        relation: "supports",
                      },
                      {
                        title: "Australia - Encyclopaedia Britannica",
                        url: "https://www.britannica.com/place/Australia",
                        publisher: "Encyclopaedia Britannica",
                        snippet: "Canberra is the national capital of Australia.",
                        relation: "supports",
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const result = await commonKnowledgeAiFallbackOverride(
      "The capital of Australia is Canberra",
      { subject: "capital of Australia", predicate: "is", object: "Canberra" },
    );

    expect(result?.verdict).toBe("True");
    expect(result?.sources.length).toBeGreaterThanOrEqual(2);
    expect(result?.confidence).toBeLessThanOrEqual(89);

    fetchMock.mockRestore();
    process.env.OPENAI_API_KEY = originalApiKey;
  });

  it("rejects AI fallback output when citations are not diverse", async () => {
    const originalApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    can_resolve: true,
                    verdict: "False",
                    confidence: 88,
                    explanation: "Claim contradicts known references.",
                    sources: [
                      {
                        title: "Wikipedia - France",
                        url: "https://en.wikipedia.org/wiki/France",
                        publisher: "Wikipedia",
                        snippet: "Paris is the capital of France.",
                        relation: "contradicts",
                      },
                      {
                        title: "Wikipedia - Paris",
                        url: "https://en.wikipedia.org/wiki/Paris",
                        publisher: "Wikipedia",
                        snippet: "Paris is the capital and most populous city of France.",
                        relation: "contradicts",
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const result = await commonKnowledgeAiFallbackOverride(
      "The capital of France is Lyon",
      { subject: "capital of France", predicate: "is", object: "Lyon" },
    );

    expect(result).toBeNull();

    fetchMock.mockRestore();
    process.env.OPENAI_API_KEY = originalApiKey;
  });

  it("returns false for incorrect CEO role claims via common-knowledge override", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ search: [{ id: "Q24283660", label: "OpenAI" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q24283660: {
                claims: {
                  P169: [
                    {
                      rank: "normal",
                      mainsnak: { datavalue: { value: { id: "Q57753" } } },
                    },
                  ],
                },
                labels: { en: { value: "OpenAI" } },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q57753: {
                labels: { en: { value: "Sam Altman" } },
              },
            },
          }),
          { status: 200 },
        ),
      );

    const result = await commonKnowledgeCeoOverride(
      "Elon Musk is the CEO of OpenAI",
      { subject: "Elon Musk", predicate: "is", object: "the CEO of OpenAI" },
    );

    expect(result?.verdict).toBe("False");
    expect(result?.confidence).toBeGreaterThanOrEqual(88);

    fetchMock.mockRestore();
  });

  it("resolves founder claims via common-knowledge override", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ search: [{ id: "Q95", label: "Google" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q95: {
                claims: {
                  P112: [
                    {
                      rank: "normal",
                      mainsnak: { datavalue: { value: { id: "Q9266" } } },
                    },
                  ],
                },
                labels: { en: { value: "Google" } },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q9266: {
                labels: { en: { value: "Larry Page" } },
              },
            },
          }),
          { status: 200 },
        ),
      );

    const result = await commonKnowledgeFounderOverride(
      "Larry Page is a founder of Google",
      { subject: "Larry Page", predicate: "is", object: "founder of Google" },
    );

    expect(result?.verdict).toBe("True");
    expect(result?.confidence).toBeGreaterThanOrEqual(90);

    fetchMock.mockRestore();
  });

  it("resolves prime minister claims via common-knowledge override", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ search: [{ id: "Q668", label: "India" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q668: {
                claims: {
                  P6: [
                    {
                      rank: "normal",
                      mainsnak: { datavalue: { value: { id: "Q1058" } } },
                    },
                  ],
                },
                labels: { en: { value: "India" } },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q1058: {
                labels: { en: { value: "Narendra Modi" } },
              },
            },
          }),
          { status: 200 },
        ),
      );

    const result = await commonKnowledgePrimeMinisterOverride(
      "Narendra Modi is the prime minister of India",
      { subject: "Narendra Modi", predicate: "is", object: "the prime minister of India" },
    );

    expect(result?.verdict).toBe("True");

    fetchMock.mockRestore();
  });

  it("resolves headquarters claims via common-knowledge override", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ search: [{ id: "Q95", label: "Google" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q95: {
                claims: {
                  P159: [
                    {
                      rank: "normal",
                      mainsnak: { datavalue: { value: { id: "Q486265" } } },
                    },
                  ],
                },
                labels: { en: { value: "Google" } },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q486265: {
                labels: { en: { value: "Mountain View" } },
              },
            },
          }),
          { status: 200 },
        ),
      );

    const result = await commonKnowledgeHeadquartersOverride(
      "Google is headquartered in Mountain View",
      { subject: "Google", predicate: "is", object: "headquartered in Mountain View" },
    );

    expect(result?.verdict).toBe("True");

    fetchMock.mockRestore();
  });

  it("resolves born-in claims via common-knowledge override", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ search: [{ id: "Q937", label: "Albert Einstein" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q937: {
                claims: {
                  P19: [
                    {
                      rank: "normal",
                      mainsnak: { datavalue: { value: { id: "Q531055" } } },
                    },
                  ],
                },
                labels: { en: { value: "Albert Einstein" } },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q531055: {
                labels: { en: { value: "Ulm" } },
              },
            },
          }),
          { status: 200 },
        ),
      );

    const result = await commonKnowledgeBornInOverride(
      "Albert Einstein was born in Ulm",
      { subject: "Albert Einstein", predicate: "was", object: "born in Ulm" },
    );

    expect(result?.verdict).toBe("True");

    fetchMock.mockRestore();
  });

  it("resolves died-in claims via common-knowledge override", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ search: [{ id: "Q937", label: "Albert Einstein" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q937: {
                claims: {
                  P20: [
                    {
                      rank: "normal",
                      mainsnak: { datavalue: { value: { id: "Q2933" } } },
                    },
                  ],
                },
                labels: { en: { value: "Albert Einstein" } },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q2933: {
                labels: { en: { value: "Princeton" } },
              },
            },
          }),
          { status: 200 },
        ),
      );

    const result = await commonKnowledgeDiedInOverride(
      "Albert Einstein died in Princeton",
      { subject: "Albert Einstein", predicate: "died", object: "in Princeton" },
    );

    expect(result?.verdict).toBe("True");

    fetchMock.mockRestore();
  });

  it("resolves spouse claims via common-knowledge override", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ search: [{ id: "Q42", label: "Barack Obama" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q42: {
                claims: {
                  P26: [
                    {
                      rank: "normal",
                      mainsnak: { datavalue: { value: { id: "Q13133" } } },
                    },
                  ],
                },
                labels: { en: { value: "Barack Obama" } },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q13133: {
                labels: { en: { value: "Michelle Obama" } },
              },
            },
          }),
          { status: 200 },
        ),
      );

    const result = await commonKnowledgeSpouseOverride(
      "Barack Obama is married to Michelle Obama",
      { subject: "Barack Obama", predicate: "is", object: "married to Michelle Obama" },
    );

    expect(result?.verdict).toBe("True");

    fetchMock.mockRestore();
  });

  it("resolves life-status claims for living public figures", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ search: [{ id: "Q1058", label: "Narendra Modi" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q1058: {
                claims: {
                  P569: [
                    {
                      rank: "normal",
                      mainsnak: { datavalue: { value: { id: "unused" } } },
                    },
                  ],
                },
                labels: { en: { value: "Narendra Modi" } },
              },
            },
          }),
          { status: 200 },
        ),
      );

    const result = await commonKnowledgeLifeStatusOverride(
      "Narendra Modi is dead",
      { subject: "Narendra Modi", predicate: "is", object: "dead" },
    );

    expect(result?.verdict).toBe("False");
    expect(result?.confidence).toBeGreaterThanOrEqual(90);

    fetchMock.mockRestore();
  });

  it("resolves life-status claims for deceased people", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ search: [{ id: "Q937", label: "Albert Einstein" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q937: {
                claims: {
                  P570: [
                    {
                      rank: "normal",
                      mainsnak: { datavalue: { value: { id: "unused" } } },
                    },
                  ],
                },
                labels: { en: { value: "Albert Einstein" } },
              },
            },
          }),
          { status: 200 },
        ),
      );

    const result = await commonKnowledgeLifeStatusOverride(
      "Albert Einstein is dead",
      { subject: "Albert Einstein", predicate: "is", object: "dead" },
    );

    expect(result?.verdict).toBe("True");
    expect(result?.confidence).toBeGreaterThanOrEqual(95);

    fetchMock.mockRestore();
  });

  it("resolves orbit claims for Earth and Sun", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ search: [{ id: "Q2", label: "Earth" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q2: {
                claims: {
                  P397: [
                    {
                      rank: "normal",
                      mainsnak: { datavalue: { value: { id: "Q525" } } },
                    },
                  ],
                },
                labels: { en: { value: "Earth" } },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q525: {
                labels: { en: { value: "Sun" } },
              },
            },
          }),
          { status: 200 },
        ),
      );

    const result = await commonKnowledgeOrbitOverride(
      "The Earth revolves around the Sun",
      null,
    );

    expect(result?.verdict).toBe("True");
    expect(result?.confidence).toBeGreaterThanOrEqual(90);

    fetchMock.mockRestore();
  });

  it("contradicts inverse orbit claims", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ search: [{ id: "Q525", label: "Sun" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q525: {
                claims: {
                  P397: [
                    {
                      rank: "normal",
                      mainsnak: { datavalue: { value: { id: "Q11995" } } },
                    },
                  ],
                },
                labels: { en: { value: "Sun" } },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q11995: {
                labels: { en: { value: "Milky Way" } },
              },
            },
          }),
          { status: 200 },
        ),
      );

    const result = await commonKnowledgeOrbitOverride(
      "The Sun revolves around the Earth",
      null,
    );

    expect(result?.verdict).toBe("False");

    fetchMock.mockRestore();
  });

  it("resolves science class facts", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ search: [{ id: "Q525", label: "Sun" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q525: {
                claims: {
                  P31: [
                    {
                      rank: "normal",
                      mainsnak: { datavalue: { value: { id: "Q523" } } },
                    },
                  ],
                },
                labels: { en: { value: "Sun" } },
              },
            },
          }),
          { status: 200 },
        ),
      );

    const result = await commonKnowledgeScienceIsAOverride(
      "The Sun is a star",
      null,
    );

    expect(result?.verdict).toBe("True");

    fetchMock.mockRestore();
  });

  it("resolves atomic number facts", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ search: [{ id: "Q629", label: "Oxygen" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q629: {
                claims: {
                  P1086: [
                    {
                      rank: "normal",
                      mainsnak: { datavalue: { value: { amount: "+8" } } },
                    },
                  ],
                },
                labels: { en: { value: "Oxygen" } },
              },
            },
          }),
          { status: 200 },
        ),
      );

    const result = await commonKnowledgeAtomicNumberOverride(
      "Oxygen has atomic number 8",
      null,
    );

    expect(result?.verdict).toBe("True");

    fetchMock.mockRestore();
  });

  it("does not use deprecated static boiling-point override", () => {
    const result = commonKnowledgeBoilingPointOverride(
      "Water boils at 100°C at sea level",
      { subject: "Water", predicate: "boils", object: "at 100°C at sea level" },
    );

    expect(result).toBeNull();
  });

  it("does not use deprecated static boiling-point contradiction path", () => {
    const result = commonKnowledgeBoilingPointOverride(
      "Water boils at 95 C at sea level",
      { subject: "Water", predicate: "boils", object: "at 95 C at sea level" },
    );

    expect(result).toBeNull();
  });

  it("does not apply water boiling point override without pressure context", () => {
    const result = commonKnowledgeBoilingPointOverride(
      "Water boils at 100 C",
      { subject: "Water", predicate: "boils", object: "at 100 C" },
    );

    expect(result).toBeNull();
  });

  it("does not use deprecated static ultra-basic phrase catalog", () => {
    const result = commonKnowledgeUltraBasicOverride("The Sun is a star");
    expect(result).toBeNull();
  });

  it("does not mark death-hoax claims true when authoritative sources contradict", () => {
    const result = scoreEvidence(
      [
        source({
          id: "reuters-1",
          publisher: "Reuters",
          url: "https://www.reuters.com/world/us/trump-campaign-2026-01-10/",
          title: "Trump appears at campaign event",
          snippet: "Donald Trump is alive and spoke publicly at a campaign event.",
          relation: "contradicts",
          relevanceScore: 92,
          authorityScore: 88,
          finalScore: 90,
          credibility: 90,
        }),
        source({
          id: "ap-1",
          publisher: "AP News",
          url: "https://apnews.com/article/trump-rumor-fact-check",
          title: "False rumor about Trump death",
          snippet: "AP confirms the rumor is false and Trump remains alive.",
          relation: "contradicts",
          relevanceScore: 90,
          authorityScore: 86,
          finalScore: 88,
          credibility: 88,
        }),
        source({
          id: "blog-1",
          publisher: "Viral Blog",
          url: "https://randomblog.example.com/trump-death-rumor",
          title: "Unverified social media thread",
          snippet: "People online are saying Donald Trump is dead.",
          relation: "supports",
          relevanceScore: 32,
          authorityScore: 35,
          finalScore: 48,
          credibility: 48,
        }),
      ],
      "Donald Trump is dead",
      { subject: "Donald Trump", predicate: "is", object: "dead" },
      {
        isBasicFact: true,
        category: "historical",
        decisivePrompt: "Decisive mode",
        isHighCertaintyFact: true,
        statusClaim: "dead",
      },
    );

    expect(result.verdict).toBe("False");
    expect(result.confidence).toBeGreaterThanOrEqual(60);
  });

  it("penalizes irrelevant supporting evidence so it cannot dominate verdict", () => {
    const result = scoreEvidence(
      [
        source({
          id: "support-low-1",
          publisher: "Speculation Hub",
          url: "https://speculation.example.com/post-1",
          relation: "supports",
          snippet: "General opinion piece with weak factual overlap.",
          relevanceScore: 28,
          authorityScore: 62,
          finalScore: 72,
          credibility: 72,
        }),
        source({
          id: "support-low-2",
          publisher: "Speculation Hub",
          url: "https://speculation.example.com/post-2",
          relation: "supports",
          snippet: "Another weakly related post.",
          relevanceScore: 30,
          authorityScore: 60,
          finalScore: 70,
          credibility: 70,
        }),
        source({
          id: "contradict-strong-1",
          publisher: "World Bank",
          url: "https://data.worldbank.org/indicator/NY.GDP.MKTP.CD",
          relation: "contradicts",
          snippet: "Official dataset shows a different top-ranked economy.",
          relevanceScore: 91,
          authorityScore: 95,
          finalScore: 90,
          credibility: 90,
        }),
      ],
      "India has the highest GDP in the world",
      { subject: "India", predicate: "has", object: "the highest GDP in the world" },
      {
        isBasicFact: true,
        category: "general",
        decisivePrompt: "Decisive mode",
        isHighCertaintyFact: true,
        statusClaim: null,
      },
    );

    expect(result.verdict).not.toBe("True");
    expect(result.contradictionWeight).toBeGreaterThan(result.supportWeight);
  });

  it("requires publisher diversity for confident directional verdicts", () => {
    const result = scoreEvidence(
      [
        source({
          id: "same-pub-1",
          publisher: "Single Outlet",
          url: "https://single.example.com/a",
          relation: "supports",
          relevanceScore: 88,
          authorityScore: 78,
          finalScore: 84,
          credibility: 84,
        }),
        source({
          id: "same-pub-2",
          publisher: "Single Outlet",
          url: "https://single.example.com/b",
          relation: "supports",
          relevanceScore: 86,
          authorityScore: 79,
          finalScore: 83,
          credibility: 83,
        }),
        source({
          id: "same-pub-3",
          publisher: "Single Outlet",
          url: "https://single.example.com/c",
          relation: "supports",
          relevanceScore: 87,
          authorityScore: 78,
          finalScore: 82,
          credibility: 82,
        }),
      ],
      "Claim text",
      { subject: "Claim", predicate: "is", object: "true" },
      {
        isBasicFact: false,
        category: "general",
        decisivePrompt: "Balanced mode",
        isHighCertaintyFact: false,
        statusClaim: null,
      },
    );

    expect(result.verdict).toBe("Unknown");
  });

  it("allows high confidence when relevance, authority, and agreement are all strong", () => {
    const result = scoreEvidence(
      [
        source({
          id: "s1",
          publisher: "World Bank",
          relation: "supports",
          relevanceScore: 94,
          authorityScore: 95,
          finalScore: 93,
          credibility: 93,
        }),
        source({
          id: "s2",
          publisher: "Reuters",
          relation: "supports",
          relevanceScore: 91,
          authorityScore: 87,
          finalScore: 90,
          credibility: 90,
        }),
        source({
          id: "s3",
          publisher: "AP News",
          relation: "supports",
          relevanceScore: 90,
          authorityScore: 86,
          finalScore: 89,
          credibility: 89,
        }),
        source({
          id: "s4",
          publisher: "UN Data",
          relation: "supports",
          relevanceScore: 93,
          authorityScore: 92,
          finalScore: 92,
          credibility: 92,
        }),
      ],
      "France is in Europe",
      { subject: "France", predicate: "is", object: "in Europe" },
      {
        isBasicFact: true,
        category: "geography",
        decisivePrompt: "Decisive mode",
        isHighCertaintyFact: true,
        statusClaim: null,
      },
    );

    expect(result.verdict).toBe("True");
    expect(result.confidence).toBeGreaterThanOrEqual(84);
  });

  it("uses Needs Verification mode for subjective claims", () => {
    const result = scoreEvidence(
      [
        source({
          id: "s-op-1",
          relation: "supports",
          relevanceScore: 88,
          authorityScore: 82,
          finalScore: 85,
          credibility: 85,
        }),
      ],
      "This policy is the best ever",
      { subject: "This policy", predicate: "is", object: "the best ever" },
      {
        isBasicFact: false,
        category: "general",
        decisivePrompt: "Balanced mode",
        isHighCertaintyFact: false,
        statusClaim: null,
        needsVerification: true,
        verificationReason: "This appears to be a subjective or value-judgment claim.",
      },
    );

    expect(result.verdict).toBe("Unknown");
    expect(result.explanation.startsWith("Needs Verification:")).toBe(true);
  });

  it("allows a single strong source to resolve basic fact claims", () => {
    const result = scoreEvidence(
      [
        source({
          id: "nasa-earth-orbit",
          publisher: "NASA",
          url: "https://solarsystem.nasa.gov/planets/earth/overview/",
          title: "Earth Overview",
          snippet: "Earth orbits the Sun.",
          relation: "supports",
          relevanceScore: 92,
          authorityScore: 94,
          finalScore: 93,
          credibility: 93,
        }),
      ],
      "Earth revolves around Sun",
      { subject: "Earth", predicate: "revolves", object: "around Sun" },
      {
        isBasicFact: true,
        category: "science",
        decisivePrompt: "Decisive mode",
        isHighCertaintyFact: true,
        statusClaim: null,
      },
    );

    expect(result.verdict).toBe("True");
    expect(result.confidence).toBeGreaterThanOrEqual(85);
  });

  it("does not use deprecated ultra-basic static override for canonical science claims", () => {
    const positive = commonKnowledgeUltraBasicOverride("Earth revolves around Sun");
    const negative = commonKnowledgeUltraBasicOverride("Sun is a planet");

    expect(positive).toBeNull();
    expect(negative).toBeNull();
  });
});
