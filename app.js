import express from "express";
import bodyParser from "body-parser";
import cookieSession from "cookie-session"; // ⬅️ ganti
import expressLayouts from "express-ejs-layouts";
import morgan from "morgan";
import path from "path";
import dayjs from "dayjs";
import { loadTx, saveTx, loadSettings, saveSettings } from "./storage.js";

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = !!process.env.VERCEL;

/* ---------- App & View ---------- */
app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(process.cwd(), "views"));
app.use(expressLayouts);
app.set("layout", "layout");
app.use("/public", express.static("public"));

/* ---------- Core Middlewares ---------- */
app.use(bodyParser.urlencoded({ extended: true }));
app.use(morgan(isProd ? "tiny" : "dev"));

// ⬇️ Cookie-session (stateless) – pengganti express-session
app.use(
  cookieSession({
    name: "fx_sess",
    secret: process.env.SESSION_SECRET || "finance-cookie-secret",
    sameSite: "lax",
    secure: isProd,
    httpOnly: true,
    maxAge: 5 * 60 * 1000 // 5 menit cukup untuk flash
  })
);

// flash helper memakai cookie-session
app.use((req, res, next) => {
  res.locals.flash = req.session?.flash || null;
  if (req.session) delete req.session.flash;
  next();
});
const flash = (req, type, msg) => { if (req.session) req.session.flash = { type, msg }; };

const currency = (n, cur="IDR") =>
  new Intl.NumberFormat("id-ID", { style:"currency", currency: cur }).format(n);

// …………… (helpers summarize, monthSlice, dailyMap, asyncHandler) tetap sama ……………

/* ---------- Routes ---------- */

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    env: isProd ? "vercel" : "local",
    hasBlobToken: !!process.env.BLOB_READ_WRITE_TOKEN
  });
});

app.get("/", async (req, res, next) => {
  try {
    const settings = await loadSettings();
    const tx = (await loadTx()).sort((a,b)=> dayjs(b.date) - dayjs(a.date));
    const yyyymm = dayjs().format("YYYY-MM");
    const curMonth = monthSlice(tx, yyyymm);
    const sum = summarize(curMonth);

    const daysInMonth = dayjs().daysInMonth();
    const map = dailyMap(curMonth);
    const today = dayjs().format("YYYY-MM-DD");
    const upToTodayIncome = Object.entries(map)
      .filter(([d])=> dayjs(d).isSameOrBefore(dayjs(today)))
      .reduce((a,[,v])=> a + v.income, 0);

    const expenseLeft = Math.max(settings.monthlyExpenseTarget - sum.expense, 0);
    const remainingDays = Math.max(daysInMonth - dayjs().date() + 1, 1);
    const suggestDailyExpense = Math.floor(expenseLeft / remainingDays);
    const dailyTargetDelta = upToTodayIncome - (settings.dailyIncomeTarget * dayjs().date());

    res.render("dashboard", {
      settings, yyyymm, sum,
      expenseLeft, suggestDailyExpense, dailyTargetDelta,
      txRecent: curMonth.slice(0, 12), currency
    });
  } catch (e) { next(e); }
});

// ⬇️ GANTI route opsional jadi dua route terpisah

// /report  (default: bulan ini)
app.get("/report", async (req, res, next) => {
  try {
    const yyyymm = dayjs().format("YYYY-MM");
    await renderReport(res, yyyymm);
  } catch (e) { next(e); }
});

// /report/:yyyymm (format "YYYY-MM")
app.get("/report/:yyyymm", async (req, res, next) => {
  try {
    await renderReport(res, req.params.yyyymm);
  } catch (e) { next(e); }
});

// helper render report
async function renderReport(res, yyyymm) {
  const settings = await loadSettings();
  const tx = (await loadTx()).sort((a,b)=> dayjs(a.date) - dayjs(b.date));
  const curMonth = monthSlice(tx, yyyymm);
  const sum = summarize(curMonth);

  const byCat = curMonth.reduce((m,t)=>{ const k=`${t.type}:${t.category||"Umum"}`; m[k]=(m[k]||0)+t.amount; return m; },{});
  const rows = Object.entries(byCat).map(([k,v])=>{ const [type,category]=k.split(":"); return { type, category, total:v }; });

  const map = dailyMap(curMonth);
  const days = Array.from({length: dayjs(yyyymm+"-01").daysInMonth()}, (_,i)=>{
    const d = dayjs(yyyymm+"-01").date(i+1).format("YYYY-MM-DD");
    const v = map[d] || { income:0, expense:0 };
    return { date:d, ...v };
  });

  res.render("report", { settings, yyyymm, sum, rows, days, currency });
}

/* ……… routes settings + transaksi tetap sama (gunakan flash dari cookie-session) ……… */

app.use((err, _req, res, _next) => {
  console.error("ERROR:", err?.stack || err);
  if (res.headersSent) return;
  res.status(500).send(isProd ? "Internal Server Error" : `<pre>${err?.stack || err}</pre>`);
});

export default app;
if (!isProd) app.listen(PORT, () => console.log(`Local: http://localhost:${PORT}`));
