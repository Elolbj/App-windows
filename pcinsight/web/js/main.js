// Shell de l'application : navigation, thème, cycle de vie des pages, états par section.
import { api } from "./api.js";
import { applyTheme } from "./charts.js";
import { badge, errorBox, html, icon, setHTML, toast } from "./ui.js";

import dashboard from "./pages/dashboard.js";
import performance from "./pages/performance.js";
import sensors from "./pages/sensors.js";
import hardware from "./pages/hardware.js";
import storage from "./pages/storage.js";
import software from "./pages/software.js";
import network from "./pages/network.js";
import security from "./pages/security.js";
import events from "./pages/events.js";
import updates from "./pages/updates.js";
import analysis from "./pages/analysis.js";
import settings from "./pages/settings.js";

// [id, libellé, icône, module, catégorie du diagnostic associée]
const GROUPS = [
  ["Vue d'ensemble", [
    ["dashboard", "Tableau de bord", "dashboard", dashboard],
    ["analysis", "Diagnostic", "report", analysis],
  ]],
  ["Système", [
    ["performance", "Performances", "activity", performance, "performance"],
    ["sensors", "Capteurs", "thermo", sensors],
    ["hardware", "Matériel", "cpu", hardware],
    ["storage", "Stockage", "disk", storage, "storage"],
  ]],
  ["Logiciels et sécurité", [
    ["software", "Logiciels", "package", software],
    ["security", "Sécurité", "shield", security, "security"],
    ["network", "Réseau", "network", network],
  ]],
  ["Historique", [
    ["events", "Événements", "alert", events, "stability"],
    ["updates", "Mises à jour", "updates", updates, "updates"],
  ]],
];
const PAGES = GROUPS.flatMap(([, items]) => items);
const SETTINGS_PAGE = ["settings", "Paramètres", "settings", settings];

const $ = (id) => document.getElementById(id);
const state = { status: null, page: null, cleanup: [], generation: 0, analysis: null };

// ------------------------------------------------------------------ thème
const THEME_KEY = "pcinsight-theme";
function storedTheme() { try { return localStorage.getItem(THEME_KEY); } catch { return null; } }
function currentTheme() {
  return storedTheme() || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
export function setTheme(theme, save = true) {
  document.documentElement.dataset.theme = theme;
  if (save) { try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignoré */ } }
  setHTML($("theme-toggle"), html`${icon(theme === "dark" ? "sun" : "moon")}${theme === "dark" ? "Thème clair" : "Thème sombre"}`);
  applyTheme();
}

// ------------------------------------------------------------------ navigation
function renderNav() {
  setHTML($("nav"), html`${GROUPS.map(([label, items]) => html`
    <div class="nav-group">${label}</div>
    ${items.map(([id, text, ico]) => html`<a href="#/${id}" data-page="${id}">${icon(ico)}<span>${text}</span><span class="count" hidden></span><span class="state" hidden></span></a>`)}`)}`);
}

function setNavCount(page, n, alert = false) {
  const el = document.querySelector(`.nav a[data-page="${page}"] .count`);
  if (!el) return;
  el.hidden = !n;
  el.textContent = n;
  el.classList.toggle("alert", alert);
}

/** Pastille d'alerte à côté des pages concernées par des problèmes du diagnostic. */
function applyAnalysis(a) {
  state.analysis = a;
  setNavCount("analysis", a.counts.critical + a.counts.warning, a.counts.critical > 0);
  for (const [id, , , , cat] of PAGES) {
    const el = document.querySelector(`.nav a[data-page="${id}"] .state`);
    if (!el) continue;
    const pageFindings = a.findings.filter((f) => f.page === id || (cat && f.category === cat && !f.page));
    const kind = pageFindings.some((f) => f.severity === "critical") ? "critical"
      : pageFindings.some((f) => f.severity === "warning") ? "warning" : "";
    el.hidden = !kind;
    el.className = `state ${kind}`;
    setHTML(el, kind ? icon(kind === "critical" ? "x" : "alert") : "");
    el.title = kind ? `${pageFindings.filter((f) => f.severity === kind).length} point(s) à voir` : "";
  }
}

async function refreshAnalysis() {
  try { applyAnalysis(await api.get("analysis")); } catch { /* sera réessayé */ }
}

function cleanupPage() {
  state.cleanup.forEach((fn) => { try { fn(); } catch { /* ignoré */ } });
  state.cleanup = [];
}

async function render(refresh = false) {
  const id = (location.hash.match(/^#\/([\w-]+)/) || [])[1] || "dashboard";
  const entry = id === "settings" ? SETTINGS_PAGE : PAGES.find((p) => p[0] === id) || PAGES[0];
  const [pageId, label, , page] = entry;
  cleanupPage();
  const gen = ++state.generation;
  state.page = pageId;

  document.querySelectorAll(".nav a, #nav-settings").forEach((a) => a.classList.toggle("active", a.dataset.page === pageId));
  $("page-title").textContent = page.title || label;
  $("page-subtitle").textContent = page.subtitle || "";
  document.title = `${label} — PC Insight`;

  const view = $("view");
  view.scrollTop = 0;
  setHTML(view, "");

  const ctx = {
    api, refresh, status: state.status, analysis: () => state.analysis,
    alive: () => gen === state.generation,
    chart(c) { state.cleanup.push(() => c.destroy()); return c; },
    every(ms, fn) {
      const t = setInterval(() => { if (gen === state.generation) fn(); }, ms);
      const stop = () => clearInterval(t);
      state.cleanup.push(stop);
      return stop;
    },
    onCleanup(fn) { state.cleanup.push(fn); },
    rerender: (r = false) => render(r),
    setNavCount,
    setAnalysis: applyAnalysis,
    setTheme,
    setActions(content) { setHTML($("page-actions"), content); },
  };

  const stamp = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  ctx.setActions(html`<span class="stamp" title="Heure du dernier affichage">Affiché à ${stamp}</span><button class="btn" id="btn-refresh" type="button">${icon("refresh")}Actualiser</button>`);
  $("btn-refresh").addEventListener("click", () => render(true));

  try {
    await page.render(view, ctx);
  } catch (err) {
    if (ctx.alive()) setHTML(view, errorBox(`Impossible d'afficher la page : ${err.message}`));
    console.error(err);
  }
}

// ------------------------------------------------------------------ barre latérale
function renderSideStatus() {
  const s = state.status;
  if (!s) return;
  $("meta").textContent = `Version ${s.version}`;
  const parts = [];
  if (s.demo) parts.push(html`<div class="banner small">${icon("info")}<span>Mode démonstration : données d'exemple pour les sections Windows.</span></div>`);
  if (s.windows && !s.admin) {
    parts.push(html`<button class="btn ghost" id="btn-admin" type="button" title="Débloque température/usure des SSD, TPM, BitLocker détaillé, durées de démarrage…">${icon("admin")}Relancer en admin</button>`);
  } else if (s.admin) {
    parts.push(html`<div style="padding:0 8px">${badge("Administrateur", "good")}</div>`);
  }
  parts.push(html`<a class="btn ghost" id="nav-settings" data-page="settings" href="#/settings">${icon("settings")}Paramètres</a>`);
  setHTML($("side-status"), html`${parts}`);
  const btn = $("btn-admin");
  if (btn) {
    btn.addEventListener("click", async () => {
      try {
        const r = await api.post("elevate");
        toast(r.ok ? "Relance avec les droits administrateur…" : r.message);
      } catch (e) { toast(e.message); }
    });
  }
}

async function boot() {
  setHTML($("brand-logo"), icon("logo"));
  setTheme(currentTheme(), false);
  $("theme-toggle").addEventListener("click", () => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    render();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    if (!storedTheme()) { setTheme(e.matches ? "dark" : "light", false); render(); }
  });
  renderNav();
  try {
    state.status = await api.get("status");
  } catch (e) {
    setHTML($("view"), errorBox(`Connexion au moteur local impossible : ${e.message}. Relancez l'application.`));
    return;
  }
  renderSideStatus();
  window.addEventListener("hashchange", () => render());
  if (!location.hash.startsWith("#/")) history.replaceState(null, "", "#/dashboard");
  render();
  refreshAnalysis();
  setInterval(refreshAnalysis, 5 * 60 * 1000);
}

boot();
