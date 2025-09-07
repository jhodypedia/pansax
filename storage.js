import fs from "fs";
import path from "path";
import { put, list } from "@vercel/blob";

const isProd = process.env.VERCEL === "1" || process.env.ON_VERCEL === "true";

const dataDir = path.join(process.cwd(), "data");
if (!isProd) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

const FILES = { tx: "transactions.json", set: "settings.json" };
const BLOB_PREFIX = process.env.BLOB_PREFIX || "finance";
const rwToken = process.env.BLOB_READ_WRITE_TOKEN || "";

// Ambil file dari Blob Storage
async function blobGet(name, fallback) {
  try {
    const { blobs } = await list({
      prefix: `${BLOB_PREFIX}/${name}`,
      token: rwToken
    });
    if (blobs && blobs.length > 0) {
      const res = await fetch(blobs[0].downloadUrl);
      if (res.ok) return await res.json();
    }
  } catch (_) {}
  return fallback;
}

// Simpan file ke Blob Storage
async function blobPut(name, data) {
  if (!rwToken) throw new Error("BLOB_READ_WRITE_TOKEN belum di-set di env");
  await put(`${BLOB_PREFIX}/${name}`, JSON.stringify(data, null, 2), {
    access: "private",
    token: rwToken,
    contentType: "application/json"
  });
}

// Load & save transaksi
export async function loadTx() {
  const file = path.join(dataDir, FILES.tx);
  const fallback =
    (!isProd && fs.existsSync(file)) ? JSON.parse(fs.readFileSync(file, "utf-8")) : [];
  if (isProd) return await blobGet(FILES.tx, fallback);
  if (!fs.existsSync(file)) fs.writeFileSync(file, "[]");
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}
export async function saveTx(arr) {
  const file = path.join(dataDir, FILES.tx);
  if (isProd) return blobPut(FILES.tx, arr);
  fs.writeFileSync(file, JSON.stringify(arr, null, 2));
}

// Load & save settings
export async function loadSettings() {
  const file = path.join(dataDir, FILES.set);
  const defaultSet = {
    currency: "IDR",
    monthlyExpenseTarget: 3000000,
    dailyIncomeTarget: 200000,
    startWeekOn: 1
  };
  const fallback =
    (!isProd && fs.existsSync(file))
      ? JSON.parse(fs.readFileSync(file, "utf-8"))
      : defaultSet;
  if (isProd) return await blobGet(FILES.set, fallback);
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(defaultSet, null, 2));
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}
export async function saveSettings(obj) {
  const file = path.join(dataDir, FILES.set);
  if (isProd) return blobPut(FILES.set, obj);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}
