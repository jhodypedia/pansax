// storage.js — aman untuk Vercel + dev lokal
import fs from "fs";
import path from "path";
import { put, list } from "@vercel/blob";

const isProd = process.env.VERCEL === "1" || process.env.ON_VERCEL === "true";
const BLOB_PREFIX = process.env.BLOB_PREFIX || "finance";
const RW_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || "";

// Direktori lokal (hanya dipakai saat dev)
const dataDir = path.join(process.cwd(), "data");
if (!isProd) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

const FILES = {
  tx: "transactions.json",
  set: "settings.json",
};

const DEFAULT_SETTINGS = {
  currency: "IDR",
  monthlyExpenseTarget: 3000000,
  dailyIncomeTarget: 200000,
  startWeekOn: 1,
};

/* -------------------- Helper Blob -------------------- */
async function blobGet(name, fallback) {
  try {
    // Cari blob dengan prefix <prefix>/<name>
    const { blobs } = await list({ prefix: `${BLOB_PREFIX}/${name}`, token: RW_TOKEN });
    if (blobs && blobs.length) {
      const res = await fetch(blobs[0].downloadUrl);
      if (res.ok) return await res.json();
    }
  } catch (e) {
    console.error("[blobGet error]", e?.message || e);
  }
  return fallback;
}

async function blobPut(name, data) {
  if (!RW_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN belum di-set di Environment Variables");
  await put(`${BLOB_PREFIX}/${name}`, JSON.stringify(data, null, 2), {
    access: "private",
    token: RW_TOKEN,
    contentType: "application/json",
  });
}

/* -------------------- Transaksi -------------------- */
export async function loadTx() {
  if (isProd) {
    // Prod → hanya dari Blob
    return await blobGet(FILES.tx, []);
  }
  // Dev → dari file
  const file = path.join(dataDir, FILES.tx);
  if (!fs.existsSync(file)) fs.writeFileSync(file, "[]");
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

export async function saveTx(arr) {
  if (isProd) {
    return blobPut(FILES.tx, arr);
  }
  const file = path.join(dataDir, FILES.tx);
  fs.writeFileSync(file, JSON.stringify(arr, null, 2));
}

/* -------------------- Settings -------------------- */
export async function loadSettings() {
  if (isProd) {
    return await blobGet(FILES.set, DEFAULT_SETTINGS);
  }
  const file = path.join(dataDir, FILES.set);
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(DEFAULT_SETTINGS, null, 2));
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

export async function saveSettings(obj) {
  if (isProd) {
    return blobPut(FILES.set, obj);
  }
  const file = path.join(dataDir, FILES.set);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}
