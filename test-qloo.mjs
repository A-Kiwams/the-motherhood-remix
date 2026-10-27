
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const folder = path.dirname(fileURLToPath(import.meta.url));
const env = dotenv.parse(
  fs.readFileSync(path.join(folder, ".env"), "utf8")
);

const apiKey = env.QLOO_API_KEY?.trim();
const baseUrl = "https://hackathon.api.qloo.com";

if (!apiKey) {
  console.error("QLOO_API_KEY is missing from .env.");
  process.exit(1);
}

async function qlooGet(endpoint, params) {
  const url = new URL(endpoint, baseUrl);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Api-Key": apiKey,
    },
    signal: AbortSignal.timeout(20000),
  });

  const text = await response.text();

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      `Qloo returned HTTP ${response.status} with a non-JSON response.`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Qloo HTTP ${response.status}: ${JSON.stringify(body).slice(0, 800)}`
    );
  }

  return body;
}

function getEntities(body) {
  if (Array.isArray(body?.results?.entities)) {
    return body.results.entities;
  }

  if (Array.isArray(body?.results)) {
    return body.results;
  }

  if (Array.isArray(body?.entities)) {
    return body.entities;
  }

  return [];
}

async function main() {
  console.log("1. Searching Qloo for Taylor Swift...");

  const search = await qlooGet("/search", {
    query: "Taylor Swift",
    types: "urn:entity:artist",
    take: "3",
  });

  const matches = getEntities(search);

  console.log("Search matches:", matches.length);

  const artist = matches.find(
    (item) => item.entity_id || item.id
  );

  if (!artist) {
    console.log(
      "No usable entity ID found. Response structure:",
      Object.keys(search)
    );
    console.log(
      "Check the current Entity Search response format before proceeding."
    );
    return;
  }

  const artistId = artist.entity_id ?? artist.id;

  console.log("Resolved artist:", artist.name ?? "Name unavailable");
  console.log("Entity ID found:", Boolean(artistId));
  console.log("\n2. Requesting movie recommendations...");

  const insights = await qlooGet("/v2/insights", {
    "filter.type": "urn:entity:movie",
    "signal.interests.entities": artistId,
    take: "5",
    "feature.explainability": "true",
  });

  const recommendations = getEntities(insights);

  console.log("Insights response received.");
  console.log("Recommendation count:", recommendations.length);

  for (const movie of recommendations.slice(0, 5)) {
    console.log({
      name: movie.name ?? "Name unavailable",
      id: movie.entity_id ?? movie.id ?? "ID unavailable",
      affinity: movie.query?.affinity ?? "Not supplied",
    });
  }

  if (recommendations.length === 0) {
    console.log("Response keys:", Object.keys(insights));
    console.log(
      "Inspect the documented response shape before interpreting the result."
    );
  }

  console.log("\nCross-category API test finished.");
}

main().catch((error) => {
  console.error("Test failed:", error.message);
  process.exitCode = 1;
});
