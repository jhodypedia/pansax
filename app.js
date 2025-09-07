import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import expressLayouts from "express-ejs-layouts";
import morgan from "morgan";
import path from "path";
import dayjs from "dayjs";
import { loadTx, saveTx, loadSettings, saveSettings } from "./storage.js";

const app = express();
const PORT = process.env.PORT || 3000;

// view & static
app.set("view engine", "ejs");
app.set("views", path.join(process.cwd(), "views"));
app.use(expressLayouts);
app.set("layout", "layout");
app.use("/public", express.static("public"));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(morgan("dev"));
app.use(session({ secret: "finance-secret", resave: false, saveUninitialized: true }));

// flash helper
app.use((req, res, next) => { res.locals.flash = req.session.flash || null; delete req.session.flash; next(); });
const flash = (req, type, msg) => (req.session.flash = { type, msg });
const currency = (n, cur="IDR") => new Intl.NumberFormat("id-ID", { style:"currency", currency: cur }).format(n);

// helpers
const monthSlice = (tx, yyyymm) => {
  const start = dayjs(yyyymm + "-01");
  const end = start.endOf("month");
  return tx.filter(t => dayjs(t.date).isAfter(start.subtract(1,"day")) && dayjs(t.date).isBefore(end.add(1,"second")));
};
const summarize = (tx) => {
  const income = tx.filter(t=>t.type==="income").reduce((a,b)=>a+b.amount,0);
  const expense = tx.filter(t=>t.type==="expense").reduce((a,b)=>a+b.amount,0);
  return { income, expense, balance: income - expense };
};
const dailyMap = (tx) => tx.reduce((m,t)=>{ const d=dayjs(t.date).format("YYYY-MM-DD"); m[d]=m[d]||{income:0,expense:0}; m[d][t.type]+=t.amount; return m; },{});

// routes
app.get("/", async (req, res) => {
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
    txRecent: curMonth.slice(0, 12),
    currency
  });
});

app.get("/report/:yyyymm?", async (req, res) => {
  const settings = await loadSettings();
  const yyyymm = req.params.yyyymm || dayjs().format("YYYY-MM");
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
});

app.get("/settings", async (_req, res) => res.render("settings", { settings: await loadSettings() }));
app.post("/settings", async (req, res) => {
  const s = await loadSettings();
  const next = {
    currency: req.body.currency || s.currency,
    monthlyExpenseTarget: Number(req.body.monthlyExpenseTarget || s.monthlyExpenseTarget),
    dailyIncomeTarget: Number(req.body.dailyIncomeTarget || s.dailyIncomeTarget),
    startWeekOn: Number(req.body.startWeekOn || s.startWeekOn)
  };
  await saveSettings(next);
  flash(req, "success", "Settings tersimpan!");
  res.redirect("/settings");
});

app.get("/tx/new", (_req, res) => res.render("tx_form", { tx: null }));
app.post("/tx/new", async (req, res) => {
  const all = await loadTx();
  all.push({
    id: Date.now().toString(36),
    date: req.body.date,
    type: req.body.type,
    category: req.body.category || "Umum",
    note: req.body.note || "",
    amount: Number(req.body.amount||0)
  });
  await saveTx(all);
  flash(req, "success", "Transaksi ditambahkan.");
  res.redirect("/");
});

app.get("/tx/:id/edit", async (req, res) => {
  const one = (await loadTx()).find(t=>t.id===req.params.id);
  if (!one) return res.status(404).send("Not found");
  res.render("tx_form", { tx: one });
});
app.post("/tx/:id/edit", async (req, res) => {
  const all = await loadTx();
  const i = all.findIndex(t=>t.id===req.params.id);
  if (i<0) return res.status(404).send("Not found");
  all[i] = { ...all[i],
    date: req.body.date, type: req.body.type,
    category: req.body.category || "Umum",
    note: req.body.note || "",
    amount: Number(req.body.amount || 0)
  };
  await saveTx(all);
  flash(req, "success", "Transaksi diperbarui.");
  res.redirect("/report/" + dayjs(req.body.date).format("YYYY-MM"));
});
app.post("/tx/:id/delete", async (req, res) => {
  const next = (await loadTx()).filter(t=>t.id!==req.params.id);
  await saveTx(next);
  flash(req, "success", "Transaksi dihapus.");
  res.redirect("back");
});

export default app;

// jalankan lokal (node app.js)
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`Local: http://localhost:${PORT}`));
}
