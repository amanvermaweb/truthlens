import { ParsedClaim } from "@/lib/fact-check/pipeline/types";

export function getCeoClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/^(.+?)\s+(?:is|was)\s+(?:the\s+)?ceo\s+of\s+(.+?)(?:[.!?]|$)/i);
  if (direct) {
    return {
      claimedPerson: direct[1].trim(),
      organization: direct[2].trim(),
    };
  }

  const possessive = inputText
    .trim()
    .match(/^(.+?)'?s\s+ceo\s+(?:is|was)\s+(.+?)(?:[.!?]|$)/i);
  if (possessive) {
    return {
      claimedPerson: possessive[2].trim(),
      organization: possessive[1].trim(),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  if (!/\bceo\b/i.test(parsedClaim.object) && !/\bceo\b/i.test(parsedClaim.subject)) {
    return null;
  }

  const parsedDirect = parsedClaim.object.match(/^(?:the\s+)?ceo\s+of\s+(.+)$/i);
  if (parsedDirect) {
    return {
      claimedPerson: parsedClaim.subject.trim(),
      organization: parsedDirect[1].trim(),
    };
  }

  const parsedPossessive = parsedClaim.subject.match(/^(.+?)'?s\s+ceo$/i);
  if (parsedPossessive) {
    return {
      claimedPerson: parsedClaim.object.trim(),
      organization: parsedPossessive[1].trim(),
    };
  }

  return null;
}

export function getFounderClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/^(.+?)\s+(?:is|was)\s+(?:(?:the|a|an)\s+)?founder\s+of\s+(.+?)(?:[.!?]|$)/i);
  if (direct) {
    return {
      claimedPerson: direct[1].trim(),
      organization: direct[2].trim(),
    };
  }

  const possessive = inputText
    .trim()
    .match(/^(.+?)'?s\s+founder\s+(?:is|was)\s+(.+?)(?:[.!?]|$)/i);
  if (possessive) {
    return {
      claimedPerson: possessive[2].trim(),
      organization: possessive[1].trim(),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  if (!/\bfounder\b/i.test(parsedClaim.object) && !/\bfounder\b/i.test(parsedClaim.subject)) {
    return null;
  }

  const parsedDirect = parsedClaim.object.match(/^(?:the\s+)?founder\s+of\s+(.+)$/i);
  if (parsedDirect) {
    return {
      claimedPerson: parsedClaim.subject.trim(),
      organization: parsedDirect[1].trim(),
    };
  }

  const parsedPossessive = parsedClaim.subject.match(/^(.+?)'?s\s+founder$/i);
  if (parsedPossessive) {
    return {
      claimedPerson: parsedClaim.object.trim(),
      organization: parsedPossessive[1].trim(),
    };
  }

  return null;
}

export function getPresidentClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/^(.+?)\s+(?:is|was)\s+(?:the\s+)?president\s+of\s+(.+?)(?:[.!?]|$)/i);
  if (direct) {
    return {
      claimedPerson: direct[1].trim(),
      entity: direct[2].trim(),
    };
  }

  const possessive = inputText
    .trim()
    .match(/^(.+?)'?s\s+president\s+(?:is|was)\s+(.+?)(?:[.!?]|$)/i);
  if (possessive) {
    return {
      claimedPerson: possessive[2].trim(),
      entity: possessive[1].trim(),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  if (!/\bpresident\b/i.test(parsedClaim.object) && !/\bpresident\b/i.test(parsedClaim.subject)) {
    return null;
  }

  const parsedDirect = parsedClaim.object.match(/^(?:the\s+)?president\s+of\s+(.+)$/i);
  if (parsedDirect) {
    return {
      claimedPerson: parsedClaim.subject.trim(),
      entity: parsedDirect[1].trim(),
    };
  }

  const parsedPossessive = parsedClaim.subject.match(/^(.+?)'?s\s+president$/i);
  if (parsedPossessive) {
    return {
      claimedPerson: parsedClaim.object.trim(),
      entity: parsedPossessive[1].trim(),
    };
  }

  return null;
}

export function getPrimeMinisterClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/^(.+?)\s+(?:is|was)\s+(?:the\s+)?prime\s+minister\s+of\s+(.+?)(?:[.!?]|$)/i);
  if (direct) {
    return {
      claimedPerson: direct[1].trim(),
      entity: direct[2].trim(),
    };
  }

  const possessive = inputText
    .trim()
    .match(/^(.+?)'?s\s+prime\s+minister\s+(?:is|was)\s+(.+?)(?:[.!?]|$)/i);
  if (possessive) {
    return {
      claimedPerson: possessive[2].trim(),
      entity: possessive[1].trim(),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  if (!/\bprime\s+minister\b/i.test(parsedClaim.object) && !/\bprime\s+minister\b/i.test(parsedClaim.subject)) {
    return null;
  }

  const parsedDirect = parsedClaim.object.match(/^(?:the\s+)?prime\s+minister\s+of\s+(.+)$/i);
  if (parsedDirect) {
    return {
      claimedPerson: parsedClaim.subject.trim(),
      entity: parsedDirect[1].trim(),
    };
  }

  const parsedPossessive = parsedClaim.subject.match(/^(.+?)'?s\s+prime\s+minister$/i);
  if (parsedPossessive) {
    return {
      claimedPerson: parsedClaim.object.trim(),
      entity: parsedPossessive[1].trim(),
    };
  }

  return null;
}

export function getHeadquartersClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/^(.+?)\s+(?:is|was)\s+headquartered\s+in\s+(.+?)(?:[.!?]|$)/i);
  if (direct) {
    return {
      entity: direct[1].trim(),
      claimedLocation: direct[2].trim(),
    };
  }

  const inverse = inputText
    .trim()
    .match(/^headquarters\s+of\s+(.+?)\s+(?:is|was|are)\s+(.+?)(?:[.!?]|$)/i);
  if (inverse) {
    return {
      entity: inverse[1].trim(),
      claimedLocation: inverse[2].trim(),
    };
  }

  const possessive = inputText
    .trim()
    .match(/^(.+?)'?s\s+headquarters\s+(?:is|was|are)\s+(.+?)(?:[.!?]|$)/i);
  if (possessive) {
    return {
      entity: possessive[1].trim(),
      claimedLocation: possessive[2].trim(),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  const parsedHeadquartered = parsedClaim.object.match(/^headquartered\s+in\s+(.+)$/i);
  if (parsedHeadquartered) {
    return {
      entity: parsedClaim.subject.trim(),
      claimedLocation: parsedHeadquartered[1].trim(),
    };
  }

  const parsedInverse = parsedClaim.subject.match(/^headquarters\s+of\s+(.+)$/i);
  if (parsedInverse) {
    return {
      entity: parsedInverse[1].trim(),
      claimedLocation: parsedClaim.object.trim(),
    };
  }

  return null;
}

export function getBornInClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/^(.+?)\s+(?:is|was)?\s*born\s+in\s+(.+?)(?:[.!?]|$)/i);
  if (direct) {
    return {
      person: direct[1].trim(),
      claimedLocation: direct[2].trim(),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  const parsedDirect = parsedClaim.object.match(/^born\s+in\s+(.+)$/i);
  if (parsedDirect) {
    return {
      person: parsedClaim.subject.trim(),
      claimedLocation: parsedDirect[1].trim(),
    };
  }

  return null;
}

export function getDiedInClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/^(.+?)\s+(?:is|was)?\s*(?:died|dead)\s+in\s+(.+?)(?:[.!?]|$)/i);
  if (direct) {
    return {
      person: direct[1].trim(),
      claimedLocation: direct[2].trim(),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  const parsedDirect = parsedClaim.object.match(/^(?:died|dead)\s+in\s+(.+)$/i);
  if (parsedDirect) {
    return {
      person: parsedClaim.subject.trim(),
      claimedLocation: parsedDirect[1].trim(),
    };
  }

  return null;
}

export function getSpouseClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const directSpouse = inputText
    .trim()
    .match(/^(.+?)\s+(?:is|was)\s+(?:the\s+)?spouse\s+of\s+(.+?)(?:[.!?]|$)/i);
  if (directSpouse) {
    return {
      person: directSpouse[1].trim(),
      claimedSpouse: directSpouse[2].trim(),
    };
  }

  const marriedTo = inputText
    .trim()
    .match(/^(.+?)\s+(?:is|was)\s+married\s+to\s+(.+?)(?:[.!?]|$)/i);
  if (marriedTo) {
    return {
      person: marriedTo[1].trim(),
      claimedSpouse: marriedTo[2].trim(),
    };
  }

  const possessive = inputText
    .trim()
    .match(/^(.+?)'?s\s+spouse\s+(?:is|was)\s+(.+?)(?:[.!?]|$)/i);
  if (possessive) {
    return {
      person: possessive[1].trim(),
      claimedSpouse: possessive[2].trim(),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  const parsedSpouseOf = parsedClaim.object.match(/^(?:the\s+)?spouse\s+of\s+(.+)$/i);
  if (parsedSpouseOf) {
    return {
      person: parsedClaim.subject.trim(),
      claimedSpouse: parsedSpouseOf[1].trim(),
    };
  }

  const parsedMarriedTo = parsedClaim.object.match(/^married\s+to\s+(.+)$/i);
  if (parsedMarriedTo) {
    return {
      person: parsedClaim.subject.trim(),
      claimedSpouse: parsedMarriedTo[1].trim(),
    };
  }

  return null;
}

export function getOrbitClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/^(.+?)\s+(?:revolves?|orbits?)\s+around\s+(.+?)(?:[.!?]|$)/i);
  if (direct) {
    return {
      body: direct[1].trim(),
      claimedCenter: direct[2].trim(),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  const parsedAround = parsedClaim.object.match(/^around\s+(.+)$/i);
  if (parsedAround && /\b(revolve|orbit)\b/i.test(parsedClaim.predicate)) {
    return {
      body: parsedClaim.subject.trim(),
      claimedCenter: parsedAround[1].trim(),
    };
  }

  return null;
}

export function getLifeStatusClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/^(.+?)\s+(?:is|was|has been)\s+(dead|deceased|alive|living)(?:[.!?]|$)/i);
  if (direct) {
    const status = /dead|deceased/i.test(direct[2]) ? "dead" : "alive";
    return {
      person: direct[1].trim(),
      claimedStatus: status as "dead" | "alive",
    };
  }

  if (!parsedClaim) {
    return null;
  }

  const objectText = `${parsedClaim.predicate} ${parsedClaim.object}`.toLowerCase();
  if (/\b(dead|deceased|died)\b/.test(objectText)) {
    return {
      person: parsedClaim.subject.trim(),
      claimedStatus: "dead" as const,
    };
  }

  if (/\b(alive|living)\b/.test(objectText)) {
    return {
      person: parsedClaim.subject.trim(),
      claimedStatus: "alive" as const,
    };
  }

  return null;
}

export function normalizeEntityName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|inc|llc|ltd|corp|corporation|company|plc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeLocationName(value: string) {
  return value
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|city|state|province)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type ScienceClassConfig = {
  claimLabel: string;
  qid: string;
};

export const SCIENCE_CLASS_MAP: ScienceClassConfig[] = [
  { claimLabel: "planet", qid: "Q634" },
  { claimLabel: "star", qid: "Q523" },
  { claimLabel: "moon", qid: "Q2537" },
  { claimLabel: "galaxy", qid: "Q318" },
  { claimLabel: "element", qid: "Q11344" },
  { claimLabel: "chemical element", qid: "Q11344" },
];

export function getScienceIsAClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/^(.+?)\s+(?:is|was)\s+(?:a|an|the)?\s*(planet|star|moon|galaxy|element|chemical element)(?:[.!?]|$)/i);
  if (direct) {
    return {
      entity: direct[1].trim(),
      claimedClass: direct[2].trim().toLowerCase(),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  const parsedObject = parsedClaim.object
    .trim()
    .toLowerCase()
    .match(/^(?:a|an|the)?\s*(planet|star|moon|galaxy|element|chemical element)$/i);
  if (!parsedObject) {
    return null;
  }

  return {
    entity: parsedClaim.subject.trim(),
    claimedClass: parsedObject[1].trim().toLowerCase(),
  };
}

export function getAtomicNumberClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/^(.+?)\s+has\s+(?:an\s+)?atomic\s+number\s+([0-9]{1,3})(?:[.!?]|$)/i);
  if (direct) {
    return {
      entity: direct[1].trim(),
      claimedAtomicNumber: Number.parseInt(direct[2], 10),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  const parsedObject = parsedClaim.object
    .trim()
    .toLowerCase()
    .match(/^(?:an\s+)?atomic\s+number\s+([0-9]{1,3})$/i);
  if (!parsedObject) {
    return null;
  }

  return {
    entity: parsedClaim.subject.trim(),
    claimedAtomicNumber: Number.parseInt(parsedObject[1], 10),
  };
}
