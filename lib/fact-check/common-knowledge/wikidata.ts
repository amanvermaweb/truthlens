const REQUEST_TIMEOUT_MS = 3000;

export type WikidataClaimEntry = {
	mainsnak?: { datavalue?: { value?: { id?: string } | { amount?: string | number } | unknown } };
	rank?: string;
};

export type WikidataClaims = Record<string, WikidataClaimEntry[]>;

export type WikidataEntitySearch = {
	id: string;
	label: string;
};

type WikidataEntityPayload = {
	entities?: Record<
		string,
		{
			claims?: WikidataClaims;
			labels?: Record<string, { value?: string }>;
		}
	>;
};

async function fetchWithTimeout(url: string, init?: RequestInit) {
	const controller = new AbortController();
	const timeout = setTimeout(() => {
		controller.abort();
	}, REQUEST_TIMEOUT_MS);

	try {
		return await fetch(url, {
			...init,
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timeout);
	}
}

export async function searchWikidataEntity(query: string): Promise<WikidataEntitySearch | null> {
	const searchResponse = await fetchWithTimeout(
		`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&format=json&limit=1&type=item`,
	);
	if (!searchResponse.ok) {
		return null;
	}

	const payload = (await searchResponse.json()) as {
		search?: Array<{ id?: string; label?: string }>;
	};
	const hit = payload.search?.[0];
	if (!hit?.id) {
		return null;
	}

	return {
		id: hit.id,
		label: hit.label ?? query,
	};
}

export async function getWikidataEntities(
	ids: string[],
	props: "claims|labels" | "labels" = "claims|labels",
): Promise<WikidataEntityPayload | null> {
	if (ids.length === 0) {
		return null;
	}

	const response = await fetchWithTimeout(
		`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(ids.join("|"))}&format=json&props=${encodeURIComponent(props)}`,
	);
	if (!response.ok) {
		return null;
	}

	return (await response.json()) as WikidataEntityPayload;
}

export function extractItemIdsFromClaims(claims: WikidataClaims | undefined, propertyId: string) {
	return (claims?.[propertyId] ?? [])
		.filter((claim) => claim.rank !== "deprecated")
		.map((claim) => {
			const value = claim.mainsnak?.datavalue?.value;
			if (typeof value !== "object" || value === null || !("id" in value)) {
				return undefined;
			}

			return typeof value.id === "string" ? value.id : undefined;
		})
		.filter((value): value is string => typeof value === "string");
}

export function hasWikidataClaim(claims: WikidataClaims | undefined, propertyId: string) {
	const entries = claims?.[propertyId] ?? [];
	return entries.some((entry) => entry.rank !== "deprecated");
}

export function extractNumericClaimValues(claims: WikidataClaims | undefined, propertyId: string) {
	const entries = claims?.[propertyId] ?? [];
	return entries
		.filter((entry) => entry.rank !== "deprecated")
		.map((entry) => {
			const rawValue = entry.mainsnak?.datavalue?.value as { amount?: string | number } | undefined;
			if (!rawValue || rawValue.amount === undefined || rawValue.amount === null) {
				return null;
			}

			const parsed = Number.parseFloat(String(rawValue.amount));
			if (!Number.isFinite(parsed)) {
				return null;
			}

			return Math.round(Math.abs(parsed));
		})
		.filter((value): value is number => value !== null);
}
