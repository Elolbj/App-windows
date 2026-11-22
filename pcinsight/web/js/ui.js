// Composants et utilitaires d'affichage.
// Toute donnée issue du système (noms de programmes, messages d'événements...) peut contenir
// du texte arbitraire : le gabarit `html` échappe systématiquement les valeurs insérées.

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s));

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderValue(v) {
  if (v === null || v === undefined || v === false) return "";
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(renderValue).join("");
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += renderValue(v) + strings[i + 1]; });
  return new Raw(out);
}

export function setHTML(el, content) { el.innerHTML = String(content); return el; }

// ------------------------------------------------------------------ icônes (traits, 24x24)
const P = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5"/>',
  disk: '<ellipse cx="12" cy="5.5" rx="8" ry="2.8"/><path d="M4 5.5v13c0 1.6 3.6 2.9 8 2.9s8-1.3 8-2.9v-13"/><path d="M4 12c0 1.6 3.6 2.9 8 2.9s8-1.3 8-2.9"/>',
  package: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  network: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9M12 3C9.5 5.6 8.2 8.6 8.2 12s1.3 6.4 3.8 9"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  updates: '<path d="M20 11a8 8 0 0 0-14.9-3.5M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.9 3.5M20 20v-4h-4"/>',
  report: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2.8h6V4M9 10h6M9 14h6M9 18h3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3.5M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.9 3.5M20 20v-4h-4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.2l2.8 2.8L16.2 9"/>',
  x: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8v.01"/>',
  unknown: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  admin: '<path d="M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6z"/><path d="M12 8v5M12 16v.01"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  memory: '<rect x="3" y="7" width="18" height="10" rx="1.5"/><path d="M7 7v10M11 7v10M15 7v10M19 17v2M5 17v2"/>',
  battery: '<rect x="2.5" y="7" width="17" height="10" rx="2"/><path d="M21.5 10.5v3"/>',
  logo: '<path d="M3 13h4l2.5-6 4 11 2.5-5H21"/>',
};

export function icon(name, cls = "") {
  return raw(`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.info}</svg>`);
}

// ------------------------------------------------------------------ formatage (français)
const nf = (d = 0) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: 0 });

export function fmtNum(n, d = 0) { return n === null || n === undefined || Number.isNaN(n) ? "—" : nf(d).format(n); }
export function fmtPct(n, d = 0) { return n === null || n === undefined ? "—" : `${fmtNum(n, d)} %`; }

export function fmtBytes(n, d = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const units = ["o", "Ko", "Mo", "Go", "To", "Po"];
  let i = 0;
  let v = Math.abs(n);
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${nf(i === 0 ? 0 : v >= 100 ? 0 : d).format(Math.sign(n) * v)} ${units[i]}`;
}
export function fmtRate(n) { return `${fmtBytes(n)}/s`; }

export function parseDate(v) {
  if (v === null || v === undefined || v === "") return null;
  const d = typeof v === "number" ? new Date(v * 1000) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
export function fmtDate(v) {
  const d = parseDate(v);
  return d ? d.toLocaleDateString("fr-FR") : "—";
}
export function fmtDateTime(v) {
  const d = parseDate(v);
  return d ? d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
}
export function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
export function fmtDuration(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d} j ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}
export function daysAgo(v) {
  const d = parseDate(v);
  return d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null;
}
export function fmtAgo(v) {
  const n = daysAgo(v);
  if (n === null) return "—";
  if (n <= 0) return "aujourd'hui";
  if (n === 1) return "hier";
  if (n < 60) return `il y a ${n} jours`;
  if (n < 730) return `il y a ${Math.round(n / 30)} mois`;
  return `il y a ${Math.round(n / 365)} ans`;
}
export const yesNo = (v) => (v === true ? "Oui" : v === false ? "Non" : "Inconnu");

// ------------------------------------------------------------------ blocs d'interface
export function card(title, body, { sub = "", tools = "", cls = "" } = {}) {
  return html`<section class="card ${raw(cls)}">
    ${title ? html`<div class="card-head"><div><h2>${title}</h2>${sub ? html`<div class="sub">${sub}</div>` : ""}</div>${tools ? html`<div class="tools">${tools}</div>` : ""}</div>` : ""}
    ${body}
  </section>`;
}

export function kv(pairs) {
  const rows = pairs.filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== "—");
  if (!rows.length) return html`<div class="empty">Aucune information.</div>`;
  return html`<dl class="kv">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`;
}

export function tile(label, value, { hint = "", unit = "", ico = "", meter: m = null, id = "" } = {}) {
  return html`<div class="tile" ${id ? raw(`id="${esc(id)}"`) : ""}>
    <div class="label">${ico ? icon(ico) : ""}${label}</div>
    <div class="value" data-role="value">${value}${unit ? html`<small>${unit}</small>` : ""}</div>
    ${hint !== null ? html`<div class="hint" data-role="hint">${hint || raw("&nbsp;")}</div>` : ""}
    ${m !== null ? m : ""}
  </div>`;
}

/** Jauge : la couleur porte la gravité selon les seuils (avertissement, critique). */
export function meter(pct, { warn = 80, crit = 90, invert = false, thin = false, kind = null } = {}) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  let k = kind;
  if (!k) {
    const v = invert ? 100 - p : p;
    k = v >= crit ? "critical" : v >= warn ? "warning" : "";
  }
  return html`<div class="meter ${raw(k)} ${thin ? "thin" : ""}" role="meter" aria-valuenow="${Math.round(p)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p.toFixed(1)}%"></span></div>`;
}

const BADGE_ICON = { good: "check", warning: "alert", serious: "alert", critical: "x", info: "info", unknown: "unknown" };
export function badge(text, kind = "") {
  return html`<span class="badge ${raw(kind)}">${BADGE_ICON[kind] ? icon(BADGE_ICON[kind]) : ""}${text}</span>`;
}

export function loading(text = "Chargement…") {
  return html`<div class="loading"><span class="spinner"></span><span>${text}</span></div>`;
}
export function skeleton(lines = 3) {
  return html`${Array.from({ length: lines }, (_, i) => html`<div class="skeleton" style="width:${90 - i * 15}%"></div>`)}`;
}
export function errorBox(text) {
  return html`<div class="error-box">${text}</div>`;
}

export function seg(options, active, attr = "data-value") {
  return html`<div class="seg" role="tablist">${options.map(([value, label]) =>
    html`<button type="button" role="tab" ${raw(attr)}="${value}" class="${value === active ? "on" : ""}" aria-selected="${value === active}">${label}</button>`)}</div>`;
}

/** Relie un contrôle segmenté à une fonction de rappel. */
export function bindSeg(root, selector, onChange) {
  const box = root.querySelector(selector);
  if (!box) return;
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-value]");
    if (!b) return;
    box.querySelectorAll("button").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", x === b); });
    onChange(b.dataset.value);
  });
}

export function toast(text, ms = 4000) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function notes(list) {
  const items = (list || []).filter(Boolean);
  if (!items.length) return "";
  return html`<ul class="notes">${items.map((n) => html`<li>${n}</li>`)}</ul>`;
}

/** Messages d'erreur PowerShell rendus lisibles (droits admin, etc.). */
export function scriptNotes(errors, isAdmin) {
  if (!errors || !errors.length) return "";
  const denied = errors.some((e) => /acc[eè]s refus|access is denied|administrat/i.test(e));
  return html`<details class="notes"><summary>${errors.length} information(s) non disponible(s)${denied && !isAdmin ? " — certaines nécessitent les droits administrateur" : ""}</summary>${notes(errors)}</details>`;
}

// ------------------------------------------------------------------ tableau de données
/**
 * Tableau triable avec recherche et pagination.
 * columns : [{ key, label, render?(row) -> html, value?(row) -> valeur de tri, num?, cls? }]
 */
export class DataTable {
  constructor(el, { columns, rows = [], search = true, pageSize = 50, sortKey = null, sortDir = "asc", empty = "Aucun élément.", filters = "" }) {
    Object.assign(this, { el, columns, rows, search, pageSize, sortKey, sortDir, empty, filters });
    this.query = "";
    this.limit = pageSize;
    this.extraFilter = null;
    this.mount();
  }

  setRows(rows) { this.rows = rows || []; this.renderBody(); }
  setFilter(fn) { this.extraFilter = fn; this.limit = this.pageSize; this.renderBody(); }

  mount() {
    setHTML(this.el, html`
      ${this.search || this.filters ? html`<div class="table-tools">
        ${this.search ? html`<input type="search" placeholder="Rechercher…" aria-label="Rechercher">` : ""}
        ${this.filters}
        <span class="count"></span>
      </div>` : ""}
      <div class="table-wrap"><table class="data"><thead><tr>${this.columns.map((c) =>
        html`<th class="${raw(c.num ? "num " : "")}sortable" data-key="${c.key}">${c.label}<span class="arrow"></span></th>`)}</tr></thead><tbody></tbody></table></div>
      <div class="more"></div>`);
    const input = this.el.querySelector('input[type="search"]');
    if (input) input.addEventListener("input", () => { this.query = input.value.trim().toLowerCase(); this.limit = this.pageSize; this.renderBody(); });
    this.el.querySelector("thead").addEventListener("click", (e) => {
      const th = e.target.closest("th[data-key]");
      if (!th) return;
      const key = th.dataset.key;
      this.sortDir = this.sortKey === key && this.sortDir === "asc" ? "desc" : (this.sortKey === key ? "asc" : (this.colByKey(key).num ? "desc" : "asc"));
      this.sortKey = key;
      this.renderBody();
    });
    this.renderBody();
  }

  colByKey(k) { return this.columns.find((c) => c.key === k) || {}; }

  sortValue(row, col) {
    const v = col.value ? col.value(row) : row[col.key];
    return v === null || v === undefined ? "" : v;
  }

  filtered() {
    let rows = this.rows;
    if (this.extraFilter) rows = rows.filter(this.extraFilter);
    if (this.query) {
      rows = rows.filter((r) => this.columns.some((c) => String(this.sortValue(r, c)).toLowerCase().includes(this.query)));
    }
    if (this.sortKey) {
      const col = this.colByKey(this.sortKey);
      const dir = this.sortDir === "asc" ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const va = this.sortValue(a, col), vb = this.sortValue(b, col);
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
        if (va === "" && vb !== "") return 1;  // valeurs vides toujours en bas
        if (vb === "" && va !== "") return -1;
        return String(va).localeCompare(String(vb), "fr", { numeric: true, sensitivity: "base" }) * dir;
      });
    }
    return rows;
  }

  renderBody() {
    const rows = this.filtered();
    const shown = rows.slice(0, this.limit);
    const tbody = this.el.querySelector("tbody");
    setHTML(tbody, shown.length ? html`${shown.map((r) => html`<tr>${this.columns.map((c) =>
      html`<td class="${raw([c.num ? "num" : "", c.cls || ""].join(" "))}">${c.render ? c.render(r) : (r[c.key] ?? "—")}</td>`)}</tr>`)}`
      : html`<tr><td colspan="${this.columns.length}" class="empty">${this.empty}</td></tr>`);
    this.el.querySelectorAll("th[data-key]").forEach((th) => {
      th.querySelector(".arrow").textContent = th.dataset.key === this.sortKey ? (this.sortDir === "asc" ? "▲" : "▼") : "";
    });
    const count = this.el.querySelector(".count");
    if (count) count.textContent = rows.length === this.rows.length ? `${fmtNum(rows.length)} élément(s)` : `${fmtNum(rows.length)} sur ${fmtNum(this.rows.length)}`;
    const more = this.el.querySelector(".more");
    setHTML(more, rows.length > this.limit ? html`<button class="btn small" type="button">Afficher ${Math.min(this.pageSize, rows.length - this.limit)} de plus (${fmtNum(rows.length - this.limit)} restants)</button>` : "");
    const btn = more.querySelector("button");
    if (btn) btn.addEventListener("click", () => { this.limit += this.pageSize; this.renderBody(); });
  }
}
