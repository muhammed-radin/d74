"use strict";

/* ------------------------------------------------------------------
   D74 Edits — password + credential helpers
   scrypt for member passwords and the administrator password. Every
   comparison is timing-safe.
------------------------------------------------------------------ */

const crypto = require("crypto");
const config = require("./config");

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

let adminPasswordRecord = null;

function scrypt(password, salt, keylen = SCRYPT.keylen) {
  return crypto.scryptSync(String(password), String(salt), keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
}

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString("hex");
  const hash = scrypt(password, useSalt).toString("hex");
  return { salt: useSalt, hash };
}

function verifyPassword(password, record) {
  if (!record || !record.passwordHash || !record.salt) return false;
  try {
    const candidate = scrypt(password, record.salt);
    const stored = Buffer.from(record.passwordHash, "hex");
    if (candidate.length !== stored.length) return false;
    return crypto.timingSafeEqual(candidate, stored);
  } catch (_) {
    return false;
  }
}

function initialAdminPassword() {
  if (config.admin.passwordHash) {
    return {
      salt: config.admin.passwordHash.salt,
      hash: config.admin.passwordHash.hash,
    };
  }
  if (!config.admin.password) return null;
  return hashPassword(config.admin.password, crypto.randomBytes(16).toString("hex"));
}

function getAdminPasswordRecord() {
  if (!adminPasswordRecord) adminPasswordRecord = initialAdminPassword();
  return adminPasswordRecord;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest();
}

function safeEqualStrings(a, b) {
  const left = sha256(a);
  const right = sha256(b);
  return crypto.timingSafeEqual(left, right);
}

function verifyAdminCredentials(username, password) {
  const expectedUser = config.admin.username || "admin";
  const record = getAdminPasswordRecord();
  if (!record) return { ok: false, reason: "not-configured" };

  const userOk = safeEqualStrings(username, expectedUser);
  let passOk = false;
  try {
    const candidate = scrypt(password, record.salt);
    const stored = Buffer.from(record.hash, "hex");
    passOk = candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
  } catch (_) {
    passOk = false;
  }
  return { ok: userOk && passOk, reason: userOk && passOk ? "ok" : "invalid" };
}

function hashForDisplay(password) {
  const { salt, hash } = hashPassword(password);
  return "scrypt$" + salt + "$" + hash;
}

module.exports = {
  hashPassword,
  verifyPassword,
  verifyAdminCredentials,
  safeEqualStrings,
  hashForDisplay,
  hashPasswordRaw: scrypt,
  SCRYPT,
};
