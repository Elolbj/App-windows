// Shell de l'application : navigation, thème, cycle de vie des pages.
import { api } from "./api.js";
import { applyTheme } from "./charts.js";
import { badge, errorBox, html, icon, setHTML, toast } from "./ui.js";

import dashboard from "./pages/dashboard.js";
import performance from "./pages/performance.js";
import hardware from "./pages/hardware.js";
import storage from "./pages/storage.js";
import software from "./pages/software.js";
import network from "./pages/network.js";
import security from "./pages/security.js";
import events from "./pages/events.js";
import updates from "./pages/updates.js";
import analysis from "./pages/analysis.js";

const PAGES = [
  ["dashboard", "Tableau de bord", "dashboard", dashboard],
  ["performance", "Performances", "activity", performance],
  ["hardware", "Matériel", "cpu", hardware],
  ["storage", "Stockage", "disk", storage],
  ["software", "Logiciels", "package", software],
  ["network", "Réseau", "network", network],
  ["security", "Sécurité", "shield", security],
  ["events", "Événements", "alert", events],
  ["updates", "Mises à jour", "updates", updates],
  ["analysis", "Diagnostic", "report", analysis],
];

const $ = (id) => document.getElementById(id);
const state = { status: null, page: null, cleanup: [], generation: 0 };

// ------------------------------------------------------------------ thème
const THEME_KEY = "pcinsight-theme";
function storedTheme() { try { return localStorage.getItem(THEME_KEY); } catch { return null; } }
function currentTheme() {
  return storedTheme() || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
function setTheme(theme, save = true) {
  document.documentElement.dataset.theme = theme;
  if (save) { try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignoré */ } }
  setHTML($("theme-toggle"), html`${icon(theme === "dark" ? "sun" : "moon")}${theme === "dark" ? "Thème clair" : "Thème sombre"}`);
  applyTheme();
}

// ------------------------------------------------------------------ navigation
function renderNav() {
  setHTML($("nav"), html`${PAGES.map(([id, label, ico]) =>
    html`<a href="#/${id}" data-page="${id}">${icon(ico)}<span>${label}</span><span class="count" hidden></span></a>`)}`);
}

export function setNavCount(page, n, alert = false) {
  const el = document.querySelector(`.nav a[data-page="${page}"] .count`);
  if (!el) return;
  el.hidden = !n;
  el.textContent = n;
  el.classList.toggle("alert", alert);
}

function cleanupPage() {
  state.cleanup.forEach((fn) => { try { fn(); } catch { /* ignoré */ } });
  state.cleanup = [];
}

async function render(refresh = false) {
  const id = (location.hash.match(/^#\/([\w-]+)/) || [])[1] || "dashboard";
  const entry = PAGES.find((p) => p[0] === id) || PAGES[0];
  const [pageId, label, , page] = entry;
  cleanupPage();
  const gen = ++state.generation;
  state.page = pageId;

  document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.page === pageId));
  $("page-title").textContent = page.title || label;
  $("page-subtitle").textContent = page.subtitle || "";
  document.title = `${label} — PC Insight`;

  const view = $("view");
  view.scrollTop = 0;
  setHTML(view, "");

  const ctx = {
    api, refresh, status: state.status,
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
    setActions(content) { setHTML($("page-actions"), content); },
  };

  // bouton Actualiser par défaut (les pages peuvent ajouter leurs actions)
  ctx.setActions(html`<button class="btn" id="btn-refresh" type="button">${icon("refresh")}Actualiser</button>`);
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
    parts.push(html`<button class="btn ghost" id="btn-admin" type="button" title="Accès aux compteurs SSD, TPM, BitLocker détaillé…">${icon("admin")}Relancer en admin</button>`);
  } else if (s.admin) {
    parts.push(html`<div style="padding:0 8px">${badge("Administrateur", "good")}</div>`);
  }
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
  setHTML($("theme-toggle"), "");
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
}

boot();
