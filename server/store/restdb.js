"use strict";

/* ------------------------------------------------------------------
   D74 Edits — legacy restdb provider
   restdb is disabled by default. The code is kept so the project can be
   switched back with DB_PROVIDER=restdb if it is ever needed.
------------------------------------------------------------------ */

const config = require("../config");

function collectionOf(pathAndQuery) {
  return String(pathAndQuery || "").split("?")[0].split("/")[0];
}

function validPath(pathAndQuery) {
  return /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)?(\?.*)?$/.test(String(pathAndQuery || ""));
}

function upstreamUrl(pathAndQuery) {
  if (!config.db.baseUrl) {
    throw Object.assign(new Error("RESTDB_BASE_URL is not configured."), {
      status: 500,
      code: "config_error",
    });
  }
  return config.db.baseUrl + "/" + String(pathAndQuery).replace(/^\/+/, "");
}

async function request(method, pathAndQuery, body) {
  if (!validPath(pathAndQuery)) {
    throw Object.assign(new Error("Invalid data path."), { status: 400, code: "invalid_path" });
  }

  const headers = {
    "x-apikey": config.db.apiKey,
    "cache-control": "no-cache",
    Accept: "application/json",
  };
  if (body !== undefined) headers["content-type"] = "application/json";

  let response;
  try {
    response = await fetch(upstreamUrl(pathAndQuery), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(config.db.timeoutMs),
    });
  } catch (_) {
    throw Object.assign(new Error("Data service unreachable."), {
      status: 502,
      code: "db_unreachable",
    });
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = text;
    }
  }

  if (response.status >= 500) {
    if (data && typeof data === "object" && /not found/i.test(String(data.message || ""))) {
      throw Object.assign(
        new Error('The "' + collectionOf(pathAndQuery) + '" collection does not exist in the database yet.'),
        { status: 409, code: "missing_collection" }
      );
    }
    throw Object.assign(new Error("Data service returned an error."), {
      status: 502,
      code: "db_upstream",
    });
  }

  return { status: response.status, data, headers: response.headers };
}

module.exports = {
  name: "restdb",
  remote: true,
  configured: () => Boolean(config.db.baseUrl && config.db.apiKey),
  request,
};
