"use strict";

/* ------------------------------------------------------------------
   D74 Edits — static health check
   Runs `node --check` over every JavaScript file, then verifies that
   CSS braces and CSS comments are balanced. Intended for `npm run check`
   and CI; it never starts the server.

   Usage: node scripts/check.js
------------------------------------------------------------------ */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SKIP = new Set(["node_modules", ".git", ".cache", "dist", "coverage", "tmp"]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function checkJs(file) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status === 0) return null;
  return (result.stderr || result.stdout || "syntax error").trim();
}

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function checkCss(file) {
  const source = stripCssComments(fs.readFileSync(file, "utf8"));
  let depth = 0;
  for (const char of source) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth < 0) return "unbalanced closing brace";
  }
  if (depth !== 0) return "unbalanced opening brace";
  return null;
}

function main() {
  const files = walk(ROOT);
  const jsFiles = files.filter((file) => file.endsWith(".js"));
  const cssFiles = files.filter((file) => file.endsWith(".css"));
  const failures = [];

  for (const file of jsFiles) {
    const error = checkJs(file);
    if (error) failures.push({ file, error });
  }

  for (const file of cssFiles) {
    const error = checkCss(file);
    if (error) failures.push({ file, error });
  }

  const relative = (file) => path.relative(ROOT, file);

  if (failures.length) {
    console.error("✗ " + failures.length + " file(s) failed:");
    for (const failure of failures) {
      console.error("  " + relative(failure.file) + " — " + failure.error.split("\n")[0]);
    }
    process.exit(1);
  }

  console.log("✓ " + jsFiles.length + " JavaScript files and " + cssFiles.length + " CSS files passed.");
}

main();
