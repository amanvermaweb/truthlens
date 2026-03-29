import {
  getInputType,
  isBlockedUrl,
  stripHtml,
} from "@/lib/analysis/input";
import { fetchWithTimeout } from "@/lib/analysis/source-fetch/shared";

export async function resolveInputText(
  input: string,
): Promise<{ inputText: string; externalFailures: string[] }> {
  const externalFailures: string[] = [];

  if (getInputType(input) !== "url") {
    return { inputText: input, externalFailures };
  }

  if (isBlockedUrl(input)) {
    return {
      inputText: input,
      externalFailures: ["Blocked private or localhost URL for safety."],
    };
  }

  try {
    const response = await fetchWithTimeout(input, {
      headers: {
        "User-Agent": "TruthLensBot/1.0 (+https://truthlens.local)",
      },
    });

    if (!response.ok) {
      externalFailures.push(`URL fetch failed with status ${response.status}.`);
      return { inputText: input, externalFailures };
    }

    const html = await response.text();
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    const descMatch = html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    );
    const text = stripHtml(html).slice(0, 700);

    const textParts = [titleMatch?.[1] ?? "", descMatch?.[1] ?? "", text]
      .map((part) => part.trim())
      .filter(Boolean);

    if (textParts.length === 0) {
      externalFailures.push("URL parsing returned empty content.");
      return { inputText: input, externalFailures };
    }

    return { inputText: textParts.join(". "), externalFailures };
  } catch {
    externalFailures.push("URL fetch timed out or failed.");
    return { inputText: input, externalFailures };
  }
}
