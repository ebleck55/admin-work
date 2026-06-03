#!/usr/bin/env node
/**
 * Mac sync agent — watches the COS desktop folder and POSTs JSON envelopes to /api/ingest.
 *
 * Env:
 *   COS_URL              base URL (no trailing slash)
 *   COS_INGEST_TOKEN     bearer token
 *   COS_WATCH_DIR        defaults to ~/Desktop/chief of staff app
 *
 * Env:
 *   COS_URL              base URL (no trailing slash)
 *   COS_INGEST_TOKEN     bearer token
 *   COS_WATCH_DIR        defaults to ~/Desktop/chief of staff app
 *
 * Note: /api/ingest is exempt from the app's login gate (it authenticates with
 * COS_INGEST_TOKEN), so no extra header is needed.
 *
 * Behavior:
 *   - Watches the directory non-recursively for new *.json files
 *   - POSTs each file to ${COS_URL}/api/ingest
 *   - On success, moves the file to <dir>/_uploaded/<YYYY-MM-DD>/
 *   - On failure, moves to <dir>/_failed/<YYYY-MM-DD>/ and logs the error
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const COS_URL = process.env.COS_URL || "http://localhost:3000";
const TOKEN = process.env.COS_INGEST_TOKEN || "";
const WATCH_DIR =
  process.env.COS_WATCH_DIR ||
  path.join(os.homedir(), "Desktop", "chief of staff app");

if (!TOKEN) {
  console.error("[cos-sync] COS_INGEST_TOKEN required");
  process.exit(1);
}

await fsp.mkdir(WATCH_DIR, { recursive: true });
await fsp.mkdir(path.join(WATCH_DIR, "_uploaded"), { recursive: true });
await fsp.mkdir(path.join(WATCH_DIR, "_failed"), { recursive: true });

console.log(`[cos-sync] watching ${WATCH_DIR}`);

const inflight = new Set();
const FILE_SETTLE_MS = 1500;

async function moveToDated(file, kind) {
  const day = new Date().toISOString().slice(0, 10);
  const dest = path.join(WATCH_DIR, `_${kind}`, day);
  await fsp.mkdir(dest, { recursive: true });
  const target = path.join(dest, path.basename(file));
  await fsp.rename(file, target);
  return target;
}

async function upload(file) {
  const body = await fsp.readFile(file, "utf8");
  const lower = file.toLowerCase();
  let url, contentType;
  if (lower.endsWith(".csv")) {
    // Salesforce pipeline CSV → batch envelope endpoint
    const stat = await fsp.stat(file);
    const fileDate = stat.mtime.toISOString().slice(0, 10);
    url = `${COS_URL}/api/ingest/csv?file_date=${fileDate}`;
    contentType = "text/csv";
  } else {
    url = `${COS_URL}/api/ingest`;
    contentType = "application/json";
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      Authorization: `Bearer ${TOKEN}`,
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text;
}

async function processFile(file) {
  if (inflight.has(file)) return;
  inflight.add(file);
  try {
    // Wait for the file to settle in case it's still being written
    await new Promise((r) => setTimeout(r, FILE_SETTLE_MS));
    const stats = await fsp.stat(file).catch(() => null);
    if (!stats || !stats.isFile()) return;
    if (!file.endsWith(".json") && !file.endsWith(".csv")) {
      console.log(`[cos-sync] skipping unsupported file: ${path.basename(file)}`);
      return;
    }
    console.log(`[cos-sync] uploading: ${path.basename(file)}`);
    const resp = await upload(file);
    console.log(`[cos-sync] ok: ${resp.slice(0, 200)}`);
    const moved = await moveToDated(file, "uploaded");
    console.log(`[cos-sync] moved → ${moved}`);
  } catch (err) {
    console.error(`[cos-sync] error on ${path.basename(file)}:`, err.message);
    try {
      await moveToDated(file, "failed");
    } catch (mvErr) {
      console.error(`[cos-sync] move-failed-also-failed:`, mvErr.message);
    }
  } finally {
    inflight.delete(file);
  }
}

// Initial sweep — pick up files already present
const initial = await fsp.readdir(WATCH_DIR);
for (const name of initial) {
  if (name.startsWith("_")) continue;
  const file = path.join(WATCH_DIR, name);
  void processFile(file);
}

// Watch for new arrivals
fs.watch(WATCH_DIR, (eventType, filename) => {
  if (!filename) return;
  if (filename.startsWith("_")) return;
  if (eventType !== "rename" && eventType !== "change") return;
  const file = path.join(WATCH_DIR, filename);
  fs.access(file, fs.constants.R_OK, (err) => {
    if (err) return;
    void processFile(file);
  });
});

process.on("SIGINT", () => {
  console.log("\n[cos-sync] shutting down");
  process.exit(0);
});
