"use strict";

/* ------------------------------------------------------------------
   D74 Edits — Firebase Firestore provider
   Server-side only. Uses a Google service account to obtain an OAuth2
   access token and talks to the Firestore REST API. Browsers never see
   the service account or the access token.

   Any of these env layouts work:
     FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
     FIREBASE_SERVICE_ACCOUNT=<base64-encoded service-account JSON>
     FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/service-account.json
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
     FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY + FIREBASE_PROJECT_ID
------------------------------------------------------------------ */

const crypto = require("crypto");
const config = require("../config");
const logger = require("../logger");

const API_ROOT = "https://firestore.googleapis.com/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/datastore";

let token = { value: "", expiresAt: 0 };

function firebaseConfig() {
  return config.db.firebase || {};
}

function configured() {
  const settings = firebaseConfig();
  return Boolean(
    settings.projectId &&
      settings.account &&
      settings.account.client_email &&
      settings.account.private_key
  );
}

function basePath() {
  const settings = firebaseConfig();
  const project = encodeURIComponent(settings.projectId);
  return API_ROOT + "/projects/" + project + "/databases/(default)/documents";
}

function collectionName(name) {
  const prefix = String(firebaseConfig().collectionPrefix || "");
  return prefix ? prefix + "_" + name : name;
}

function base64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function accessToken(force = false) {
  if (!configured()) {
    throw Object.assign(
      new Error(
        "Firebase is not configured. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH."
      ),
      { status: 500, code: "firebase_config" }
    );
  }
  if (!force && token.value && Date.now() < token.expiresAt) return token.value;

  const settings = firebaseConfig();
  const account = settings.account;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = header + "." + claim;
  let signature;
  try {
    signature = crypto
      .createSign("RSA-SHA256")
      .update(unsigned)
      .sign(String(account.private_key).replace(/\\n/g, "\n"));
  } catch (error) {
    throw Object.assign(new Error("The Firebase private key is invalid: " + error.message), {
      status: 500,
      code: "firebase_key",
    });
  }

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: unsigned + "." + base64url(signature),
  });

  let response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(config.db.timeoutMs),
    });
  } catch (_) {
    throw Object.assign(new Error("Firebase authentication is unreachable."), {
      status: 502,
      code: "firebase_unreachable",
    });
  }

  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {}
  if (!response.ok || !data || !data.access_token) {
    const detail = (data && (data.error_description || data.error)) || "token request failed";
    throw Object.assign(new Error("Firebase authentication failed: " + detail), {
      status: 502,
      code: "firebase_auth",
    });
  }

  token = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 90) * 1000,
  };
  return token.value;
}

function toValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } };
  switch (typeof value) {
    case "string":
      return { stringValue: value };
    case "boolean":
      return { booleanValue: value };
    case "number":
      return Number.isInteger(value) && Number.isSafeInteger(value)
        ? { integerValue: String(value) }
        : { doubleValue: value };
    case "object":
      return { mapValue: { fields: toFields(value) } };
    default:
      return { nullValue: null };
  }
}

function toFields(record) {
  const fields = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (key === "_id" || value === undefined) continue;
    fields[key] = toValue(value);
  }
  return fields;
}

function fromValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("bytesValue" in value) return value.bytesValue;
  if ("geoPointValue" in value) return value.geoPointValue;
  if ("arrayValue" in value) {
    return ((value.arrayValue && value.arrayValue.values) || []).map(fromValue);
  }
  if ("mapValue" in value) {
    return fromFields((value.mapValue && value.mapValue.fields) || {});
  }
  return null;
}

function fromFields(fields) {
  const record = {};
  for (const [key, value] of Object.entries(fields || {})) {
    record[key] = fromValue(value);
  }
  return record;
}

function idFromName(name) {
  const parts = String(name || "").split("/");
  return decodeURIComponent(parts[parts.length - 1] || "");
}

function fromDocument(document) {
  if (!document) return null;
  const record = fromFields(document.fields || {});
  record._id = idFromName(document.name);
  return record;
}

function safeDocId(value) {
  const id = String(value == null ? "" : value)
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .slice(0, 150);
  return id || crypto.randomBytes(12).toString("hex");
}

function documentId(collection, body) {
  if (body && body._id != null) return safeDocId(body._id);
  if (body && body.id != null) return safeDocId(body.id);
  if (collection === "videos" && body && body.ytid) return safeDocId(body.ytid);
  return safeDocId(crypto.randomBytes(12).toString("hex"));
}

function parsePath(pathAndQuery) {
  const url = new URL("http://firebase/" + String(pathAndQuery || "").replace(/^\/+/, ""));
  const segments = url.pathname.split("/").filter(Boolean);
  let query = {};
  const raw = url.searchParams.get("q");
  if (raw) {
    try {
      query = JSON.parse(raw) || {};
    } catch (_) {
      throw Object.assign(new Error("Invalid database query."), {
        status: 400,
        code: "invalid_query",
      });
    }
  }
  const maxValue = Number(url.searchParams.get("max"));
  const skipValue = Number(url.searchParams.get("skip"));
  return {
    collection: segments[0] || "",
    id: segments[1] || "",
    query: query && typeof query === "object" ? query : {},
    max: Number.isFinite(maxValue) && maxValue > 0 ? Math.floor(maxValue) : 1000,
    skip: Number.isFinite(skipValue) && skipValue > 0 ? Math.floor(skipValue) : 0,
  };
}

function operationValue(value) {
  if (Array.isArray(value)) return toValue(value);
  if (value && typeof value === "object") return toValue(value);
  return toValue(value);
}

function filtersFor(query) {
  const filters = [];
  for (const [field, expected] of Object.entries(query || {})) {
    if (field.startsWith("$")) continue;
    if (Array.isArray(expected)) {
      filters.push({
        fieldFilter: {
          field: { fieldPath: field },
          op: "IN",
          value: { arrayValue: { values: expected.map(toValue) } },
        },
      });
      continue;
    }
    if (expected && typeof expected === "object") {
      if ("$in" in expected && Array.isArray(expected.$in)) {
        filters.push({
          fieldFilter: {
            field: { fieldPath: field },
            op: "IN",
            value: { arrayValue: { values: expected.$in.map(toValue) } },
          },
        });
        continue;
      }
      if ("$ne" in expected) {
        filters.push({
          fieldFilter: {
            field: { fieldPath: field },
            op: "NOT_EQUAL",
            value: operationValue(expected.$ne),
          },
        });
        continue;
      }
      // Unsupported structured operator: compare the object itself.
    }
    filters.push({
      fieldFilter: {
        field: { fieldPath: field },
        op: "EQUAL",
        value: operationValue(expected),
      },
    });
  }
  return filters;
}

function queryBody(collection, parsed) {
  const query = {
    from: [{ collectionId: collectionName(collection) }],
    offset: parsed.skip,
    limit: parsed.max,
  };
  const filters = filtersFor(parsed.query);
  if (filters.length === 1) query.where = filters[0];
  else if (filters.length > 1) query.where = { compositeFilter: { op: "AND", filters } };
  return { structuredQuery: query };
}

async function api(pathAndQuery, options = {}) {
  const active = await accessToken();
  const url = basePath() + pathAndQuery;
  let response;
  try {
    response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        Authorization: "Bearer " + active,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(config.db.timeoutMs),
    });
  } catch (_) {
    throw Object.assign(new Error("Firebase is unreachable."), {
      status: 502,
      code: "firebase_unreachable",
    });
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {}

  if (!response.ok) {
    const detail = (data && data.error && data.error.message) || "Firestore request failed";
    let status = response.status;
    let code = "firestore_error";
    if (status === 404) {
      status = 404;
      code = "not_found";
    } else if (status === 409) {
      code = "already_exists";
    } else if (status === 429) {
      code = "firestore_quota";
    } else if (status === 401 || status === 403) {
      status = 502;
      code = "firebase_auth";
    }
    if (status === 400) code = "firestore_invalid";
    throw Object.assign(new Error(detail), { status, code, firebaseStatus: response.status });
  }
  return data;
}

async function list(collection, parsed) {
  const data = await api(":runQuery", {
    method: "POST",
    body: queryBody(collection, parsed),
  });
  const rows = (Array.isArray(data) ? data : [])
    .map((entry) => entry && entry.document)
    .filter(Boolean)
    .map(fromDocument);
  return { status: 200, data: rows, headers: new Headers() };
}

async function get(collection, id) {
  try {
    const data = await api(
      "/" + encodeURIComponent(collectionName(collection)) + "/" + encodeURIComponent(id)
    );
    return { status: 200, data: fromDocument(data), headers: new Headers() };
  } catch (error) {
    if (error.status === 404) return { status: 404, data: null, headers: new Headers() };
    throw error;
  }
}

async function create(collection, body) {
  const id = documentId(collection, body);
  const fields = toFields(body || {});
  try {
    const data = await api(
      "/" +
        encodeURIComponent(collectionName(collection)) +
        "?documentId=" +
        encodeURIComponent(id),
      { method: "POST", body: { fields } }
    );
    return { status: 201, data: fromDocument(data), headers: new Headers() };
  } catch (error) {
    if (error.status === 409) {
      throw Object.assign(new Error("A record with that id already exists."), {
        status: 409,
        code: "already_exists",
      });
    }
    throw error;
  }
}

async function update(collection, id, body) {
  const fields = toFields(body || {});
  const data = await api(
    "/" +
      encodeURIComponent(collectionName(collection)) +
      "/" +
      encodeURIComponent(id),
    { method: "PATCH", body: { fields } }
  );
  return { status: 200, data: fromDocument(data), headers: new Headers() };
}

async function remove(collection, id) {
  await api(
    "/" + encodeURIComponent(collectionName(collection)) + "/" + encodeURIComponent(id),
    { method: "DELETE" }
  );
  return { status: 200, data: { _id: id }, headers: new Headers() };
}

async function listDocuments(collection) {
  const names = [];
  let pageToken = "";
  for (let page = 0; page < 1000; page += 1) {
    const query = new URLSearchParams({ pageSize: "300" });
    if (pageToken) query.set("pageToken", pageToken);
    const data = await api(
      "/" + encodeURIComponent(collectionName(collection)) + "?" + query.toString()
    );
    for (const document of (data && data.documents) || []) {
      if (document && document.name) names.push(document.name);
    }
    pageToken = (data && data.nextPageToken) || "";
    if (!pageToken) break;
  }
  return names;
}

async function clear(collection) {
  const names = await listDocuments(collection);
  let deleted = 0;
  for (let index = 0; index < names.length; index += 400) {
    const chunk = names.slice(index, index + 400);
    await api(":commit", {
      method: "POST",
      body: { writes: chunk.map((name) => ({ delete: name })) },
    });
    deleted += chunk.length;
  }
  return { status: 200, data: { deleted }, headers: new Headers() };
}

async function request(method, pathAndQuery, body) {
  const parsed = parsePath(pathAndQuery);
  if (!parsed.collection) {
    throw Object.assign(new Error("Invalid data path."), { status: 400, code: "invalid_path" });
  }
  if (method === "GET" || method === "HEAD") {
    return parsed.id ? get(parsed.collection, parsed.id) : list(parsed.collection, parsed);
  }
  if (method === "POST") return create(parsed.collection, body);
  if (method === "PUT" || method === "PATCH") {
    if (!parsed.id) {
      throw Object.assign(new Error("A record id is required."), {
        status: 400,
        code: "missing_id",
      });
    }
    return update(parsed.collection, parsed.id, body);
  }
  if (method === "DELETE") {
    if (!parsed.id) return clear(parsed.collection);
    return remove(parsed.collection, parsed.id);
  }
  throw Object.assign(new Error("Method not allowed."), { status: 405, code: "method_not_allowed" });
}

async function init() {
  if (!configured()) return { name: "firebase", configured: false };
  logger.info("Firebase data provider ready", {
    projectId: firebaseConfig().projectId,
    collectionPrefix: firebaseConfig().collectionPrefix || null,
  });
  return {
    name: "firebase",
    configured: true,
    projectId: firebaseConfig().projectId,
  };
}

module.exports = {
  name: "firebase",
  remote: true,
  configured,
  init,
  request,
};
