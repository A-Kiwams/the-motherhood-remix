
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);

// Local development: read the existing project-root .env.
// On Render, the environment variable will be supplied by Render.
const rootEnvPath = path.resolve(currentDirectory, "../.env");
dotenv.config({ path: rootEnvPath });

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const QLOO_BASE_URL = "https://hackathon.api.qloo.com";

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  })
);

app.use(express.json({ limit: "20kb" }));

function getApiKey() {
  return process.env.QLOO_API_KEY?.trim();
}

async function qlooGet(endpoint, params) {
  const apiKey = getApiKey();

  if (!apiKey) {
    const error = new Error("Qloo API key is not configured on the server.");
    error.status = 500;
    throw error;
  }

  const url = new URL(endpoint, QLOO_BASE_URL);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Api-Key": apiKey,
    },
    signal: AbortSignal.timeout(20000),
  });

  const responseText = await response.text();

  let data;

  try {
    data = JSON.parse(responseText);
  } catch {
    data = { message: "Qloo returned a non-JSON response." };
  }

  if (!response.ok) {
    console.error("Qloo request failed with HTTP", response.status);

    const error = new Error(
      response.status >= 500
        ? "Qloo is temporarily unavailable."
        : "Qloo rejected the request. Check the request parameters."
    );

    error.status = response.status >= 500 ? 502 : response.status;
    throw error;
  }

  return data;
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

// Basic server health check. Does not expose the API key.
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "The Motherhood Remix",
    qlooKeyConfigured: Boolean(getApiKey()),
  });
});

// Search for cultural entities through Qloo.
app.get(
  "/api/qloo/search",
  asyncRoute(async (req, res) => {
    const query = String(req.query.query || "").trim();

    if (!query || query.length > 100) {
      return res.status(400).json({
        error: "Provide a search query between 1 and 100 characters.",
      });
    }

    const data = await qlooGet("/search", {
      query,
      types: "urn:entity:artist",
      take: 5,
    });

    res.json(data);
  })
);

// Get cross-category recommendations using a real Qloo entity ID.
app.get(
  "/api/qloo/insights",
  asyncRoute(async (req, res) => {
    const entityId = String(req.query.entityId || "").trim();
    const type = String(req.query.type || "urn:entity:movie").trim();

    if (!entityId || entityId.length > 500) {
      return res.status(400).json({
        error: "A valid Qloo entityId is required.",
      });
    }

    // Initially expose only the category we have verified in our API test.
    if (type !== "urn:entity:movie") {
      return res.status(400).json({
        error: "Currently supported recommendation type: urn:entity:movie",
      });
    }

    const data = await qlooGet("/v2/insights", {
      "filter.type": type,
      "signal.interests.entities": entityId,
      take: 5,
      "feature.explainability": true,
    });

    res.json(data);
  })
);

// Return safe errors without exposing keys or internal request headers.
app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  console.error("Backend request failed:", error.message);

  res.status(error.status || 500).json({
    error:
      error.status === 400
        ? error.message
        : error.status === 401 || error.status === 403
          ? "Qloo authentication or access was rejected."
          : error.status === 502
            ? error.message
            : "The server could not complete the request.",
  });
});

app.listen(PORT, () => {
  console.log(`Motherhood Remix API listening on port ${PORT}`);
});
