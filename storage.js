import fs from "fs";
import path from "path";
import { put } from "@vercel/blob";

const isProd = process.env.VERCEL === "1" || process.env.ON_VERCEL === "true";
const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const FILES = {
  tx: "transactions.json",
  set: "settings.json"
};
const BLOB_PREFIX = process.env.BLOB_PREFIX || "finance";
const rwToken = process.env.BLOB_READ_WRITE_TOKEN || "";

async function blobGet(name, fallback) {
  try {
    const url = `https://blob.vercel-storage.com/${BLOB_PREFIX}/${name}`;
    const res = await fetch(url, { headers: rwToken ? { Authorization: `Bearer ${rwToken}` } : {} });
    if (res.ok) return await res.json();
  } catch (_) {}
  return fallback;
}
async function blobPut(name, data) {
  if (!rwToken) throw new Error("BLOB_READ_WRITE_TOKEN belum di-set");
  const { url } = await put(`${BLOB_PREFIX}/${name}`, JSON.stringify(data, null, 2), {
    access: "private",
    token: rwToken,
    contentType: "application/json"
  });
  return url;
}

export async function loadTx() {
  const file = path.join(dataDir, FILES.tx);
  if (isProd) {
    const fallback = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")) : [];
    return await blobGet(FILES.tx, fallback);
  }
  if (!fs.existsSync(file)) fs.writeFileSync(file, "[]");
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}
export async function saveTx(arr) {
  const file = path.join(dataDir, FILES.tx);
  if (isProd) { await blobPut(FILES.tx, arr); return; }
  fs.writeFileSync(file, JSON.stringify(arr, null, 2));
}

export async function loadSettings() {
  const file = path.join(dataDir, FILES.set);
  const defaultSet = {
    currency: "IDR",
    monthlyExpenseTarget: 3000000,
    dailyIncomeTarget: 200000,
    startWeekOn: 1
  };
  if (isProd) {
    const fallback = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")) : defaultSet;
    return await blobGet(FILES.set, fallback);
  }
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(defaultSet, null, 2));
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}
export async function saveSettings(obj) {
  const file = path.join(dataDir, FILES.set);
  if (isProd) { await blobPut(FILES.set, obj); return; }
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}
