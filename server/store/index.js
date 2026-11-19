"use strict";

/* ------------------------------------------------------------------
   D74 Edits — database provider selection
   Firebase is the primary provider. restdb remains available behind
   DB_PROVIDER=restdb but is disabled by default. Local JSON is a
   development fallback only; production refuses to start without
   Firebase credentials so live data can never depend on a container's
   ephemeral disk.
------------------------------------------------------------------ */

const config = require("../config");
const logger = require("../logger");

let active = null;
let fallbackReason = "";

function choose() {
  if (active) return active;

  const requested = config.db.provider;
  if (requested === "restdb") {
    active = require("./restdb");
    return active;
  }
  if (requested === "local") {
    active = require("./local");
    return active;
  }

  const firebase = require("./firebase");
  if (firebase.configured()) {
    active = firebase;
    return active;
  }

  fallbackReason =
    "Firebase credentials are missing (FIREBASE_SERVICE_ACCOUNT / FIREBASE_SERVICE_ACCOUNT_PATH).";
  if (config.isProd) {
    throw new Error(
      fallbackReason +
        " Production requires Firebase so channels and videos survive restarts. " +
        "Add a Firebase service account or set DB_PROVIDER=restdb explicitly."
    );
  }
  logger.warn(fallbackReason + " Using the local development database file.");
  active = require("./local");
  return active;
}

async function init() {
  const provider = choose();
  if (provider.init) {
    const info = await provider.init();
    if (info && info.name === "firebase" && info.configured === false) {
      fallbackReason = "Firebase credentials are missing.";
    }
  }
  logger.info("Data provider: " + provider.name, {
    remote: Boolean(provider.remote),
    fallback: Boolean(fallbackReason) || undefined,
  });
  return describe();
}

function describe() {
  const provider = choose();
  return {
    name: provider.name,
    remote: Boolean(provider.remote),
    fallback: Boolean(fallbackReason),
    reason: fallbackReason || null,
    localStorage: provider.name === "local" ? config.db.localFile : null,
    firebaseProjectId:
      provider.name === "firebase" ? config.db.firebase.projectId || null : null,
  };
}

async function request(method, pathAndQuery, body) {
  return choose().request(method, pathAndQuery, body);
}

module.exports = {
  init,
  describe,
  request,
  get name() {
    return choose().name;
  },
  get remote() {
    return Boolean(choose().remote);
  },
};
