// Embeddings via Voyage AI (Anthropic's recommended embeddings partner).
// Swap the fetch call here if you switch providers - nothing else in the
// codebase depends on which provider is used.

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

export async function embed(text: string): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY is not set");
  }
  const model = process.env.VOYAGE_MODEL || "voyage-3";

  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: [truncateForEmbedding(text)],
      model,
      input_type: "document",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage embeddings request failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const vector = data?.data?.[0]?.embedding;
  if (!Array.isArray(vector)) {
    throw new Error("Voyage embeddings response missing embedding vector");
  }
  return vector;
}

// Voyage-3 has an 8k-ish practical input ceiling for a single doc; PubMed
// abstracts are well under this, but be defensive with any full-text pulls.
function truncateForEmbedding(text: string, maxChars = 20000): string {
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

export function toPgVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
