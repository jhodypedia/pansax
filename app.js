import express from "express";
import bodyParser from "body-parser";
import cookieSession from "cookie-session";
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

/* ---------- Middlewares ---------- */
app.use(bodyParser.urlencoded({ extended: true }));
app.use(morgan(isProd ? "tiny" : "dev"));

app.use(
  cookieSession({
    name: "fx_sess",
    secret: process.env.SESSION_SECRET || "finance-cookie-secret",
    sameSite: "lax",
    secure: isProd,
    httpOnly: true,
    maxAge: 5 * 60 * 1000, // 5 menit
  })
);

// flash helper
app.use((req, res, next) => {
  res.locals.flash = req.session?.flash || null;
  if (req.session) delete req.session.flash;
  next();
});
const flash = (req, type, msg) => {
  if (req.session) req.session.flash = { type, msg };
};

// format mata uang
const currency = (n, cur = "IDR") =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: cur }).format(n);

/* ---------- Helpers ---------- */
function monthSlice(tx, yyyymm) {
  const start = dayjs(yyyymm + "-01");
  const end = start.endOf("month");
  return tx.filter(
    (t) =>
      dayjs(t.date).isAfter(start.subtract(1, "day")) &&
      dayjs(t.date).isBefore(end.add(1, "second"))
  );
}

function summarize(tx) {
  const income = tx.filter((t) => t.type === "income").reduce((a, b) => a + b.amount, 0);
  const expense = tx.filter((t) => t.type === "expense").reduce((a, b) => a + b.amount, 0);
  return { income, expense, balance: income - expense };
}

function dailyMap(tx) {
  return tx.reduce((m, t) => {
    const d = dayjs(t.date).format("YYYY-MM-DD");
    m[d] = m[d] || { income: 0, expense: 0 };
    m[d][t.type] += t.amount;
    return m;
  }, {});
}

/* ---------- Routes ---------- */

// healthcheck
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    env: isProd ? "vercel" : "local",
    hasBlobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
  });
});

// dashboard
app.get("/", async (req, res, next) => {
  try {
    const settings = await loadSettings();
    const tx = (await loadTx()).sort((a, b) => dayjs(b.date) - dayjs(a.date));
    const yyyymm = dayjs().format("YYYY-MM");
    const curMonth = monthSlice(tx, yyyymm);
    const sum = summarize(curMonth);

    const daysInMonth = dayjs().daysInMonth();
    const map = dailyMap(curMonth);
    const today = dayjs().format("YYYY-MM-DD");
    const upToTodayIncome = Object.entries(map)
      .filter(([d]) => dayjs(d).isSameOrBefore(dayjs(today)))
      .reduce((a, [, v]) => a + v.income, 0);

    const expenseLeft = Math.max(settings.monthlyExpenseTarget - sum.expense, 0);
    const remainingDays = Math.max(daysInMonth - dayjs().date() + 1, 1);
    const suggestDailyExpense = Math.floor(expenseLeft / remainingDays);
    const dailyTargetDelta =
      upToTodayIncome - settings.dailyIncomeTarget * dayjs().date();

    res.render("dashboard", {
      settings,
      yyyymm,
      sum,
      expenseLeft,
      suggestDailyExpense,
      dailyTargetDelta,
      txRecent: curMonth.slice(0, 12),
      currency,
    });
  } catch (e) {
    next(e);
  }
});

// report (default bulan ini)
app.get("/report", async (req, res, next) => {
  try {
    const yyyymm = dayjs().format("YYYY-MM");
    await renderReport(res, yyyymm);
  } catch (e) {
    next(e);
  }
});

// report per bulan
app.get("/report/:yyyymm", async (req, res, next) => {
  try {
    await renderReport(res, req.params.yyyymm);
  } catch (e) {
    next(e);
  }
});

async function renderReport(res, yyyymm) {
  const settings = await loadSettings();
  const tx = (await loadTx()).sort((a, b) => dayjs(a.date) - dayjs(b.date));
  const curMonth = monthSlice(tx, yyyymm);
  const sum = summarize(curMonth);

  const byCat = curMonth.reduce((m, t) => {
    const k = `${t.type}:${t.category || "Umum"}`;
    m[k] = (m[k] || 0) + t.amount;
    return m;
  }, {});
  const rows = Object.entries(byCat).map(([k, v]) => {
    const [type, category] = k.split(":");
    return { type, category, total: v };
  });

  const map = dailyMap(curMonth);
  const days = Array.from(
    { length: dayjs(yyyymm + "-01").daysInMonth() },
    (_, i) => {
      const d = dayjs(yyyymm + "-01").date(i + 1).format("YYYY-MM-DD");
      const v = map[d] || { income: 0, expense: 0 };
      return { date: d, ...v };
    }
  );

  res.render("report", { settings, yyyymm, sum, rows, days, currency });
}

// settings
app.get("/settings", async (_req, res, next) => {
  try {
    res.render("settings", { settings: await loadSettings() });
  } catch (e) {
    next(e);
  }
});
app.post("/settings", async (req, res, next) => {
  try {
    const s = await loadSettings();
    const nextSet = {
      currency: req.body.currency || s.currency,
      monthlyExpenseTarget: Number(
        req.body.monthlyExpenseTarget || s.monthlyExpenseTarget
      ),
      dailyIncomeTarget: Number(
        req.body.dailyIncomeTarget || s.dailyIncomeTarget
      ),
      startWeekOn: Number(req.body.startWeekOn || s.startWeekOn),
    };
    await saveSettings(nextSet);
    flash(req, "success", "Settings tersimpan!");
    res.redirect("/settings");
  } catch (e) {
    next(e);
  }
});

// transaksi
app.get("/tx/new", (_req, res) => res.render("tx_form", { tx: null }));
app.post("/tx/new", async (req, res, next) => {
  try {
    const all = await loadTx();
    all.push({
      id: Date.now().toString(36),
      date: req.body.date,
      type: req.body.type,
      category: req.body.category || "Umum",
      note: req.body.note || "",
      amount: Number(req.body.amount || 0),
    });
    await saveTx(all);
    flash(req, "success", "Transaksi ditambahkan.");
    res.redirect("/");
  } catch (e) {
    next(e);
  }
});

app.get("/tx/:id/edit", async (req, res, next) => {
  try {
    const one = (await loadTx()).find((t) => t.id === req.params.id);
    if (!one) return res.status(404).send("Not found");
    res.render("tx_form", { tx: one });
  } catch (e) {
    next(e);
  }
});
app.post("/tx/:id/edit", async (req, res, next) => {
  try {
    const all = await loadTx();
    const i = all.findIndex((t) => t.id === req.params.id);
    if (i < 0) return res.status(404).send("Not found");
    all[i] = {
      ...all[i],
      date: req.body.date,
      type: req.body.type,
      category: req.body.category || "Umum",
      note: req.body.note || "",
      amount: Number(req.body.amount || 0),
    };
    await saveTx(all);
    flash(req, "success", "Transaksi diperbarui.");
    res.redirect("/report/" + dayjs(req.body.date).format("YYYY-MM"));
  } catch (e) {
    next(e);
  }
});
app.post("/tx/:id/delete", async (req, res, next) => {
  try {
    const nextTx = (await loadTx()).filter((t) => t.id !== req.params.id);
    await saveTx(nextTx);
    flash(req, "success", "Transaksi dihapus.");
    res.redirect("back");
  } catch (e) {
    next(e);
  }
});

/* ---------- Error Handler ---------- */
app.use((err, _req, res, _next) => {
  console.error("ERROR:", err?.stack || err);
  if (res.headersSent) return;
  res
    .status(500)
    .send(isProd ? "Internal Server Error" : `<pre>${err?.stack || err}</pre>`);
});

/* ---------- Export ---------- */
export default app;
if (!isProd) {
  app.listen(PORT, () =>
    console.log(`Local: http://localhost:${PORT}`)
  );
}
