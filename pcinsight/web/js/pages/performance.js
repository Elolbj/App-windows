import { bars, colors, legend, timeLine } from "../charts.js";
import { DataTable, bindSeg, card, errorBox, fmtBytes, fmtDuration, fmtNum, fmtPct, fmtRate, html, loading, meter, raw, seg, setHTML, tile } from "../ui.js";

const WINDOWS = [["120", "2 min"], ["300", "5 min"], ["600", "10 min"]];

export default {
  title: "Performances",
  subtitle: "Processeur, mémoire, disques et réseau — en direct et dans le temps",

  async render(view, ctx) {
    setHTML(view, html`
      <div class="tabs">${seg([["live", "Temps réel"], ["history", "Historique"], ["proc", "Processus"]], "live")}</div>
      <div id="tab"></div>`);
    let cleanup = [];
    let current = null;
    const show = (tab) => {
      cleanup.forEach((f) => f());
      cleanup = [];
      const token = {};
      current = token;
      const el = view.querySelector("#tab");
      const sub = {
        ...ctx,
        alive: () => ctx.alive() && current === token, // l'onglet est toujours affiché
        chart: (c) => { cleanup.push(() => c.destroy()); return ctx.chart(c); },
        every: (ms, fn) => { cleanup.push(ctx.every(ms, fn)); },
      };
      ({ live, history, proc })[tab](el, sub);
    };
    bindSeg(view, ".tabs .seg", show);
    show("live");
  },
};

// ---------------------------------------------------------------------- temps réel
function live(el, ctx) {
  const c = colors();
  let windowSec = 300;
  setHTML(el, html`
    <div class="grid cols-6">
      ${tile("Processeur", "—", { id: "l-cpu", meter: meter(0) })}
      ${tile("Mémoire vive", "—", { id: "l-ram", meter: meter(0) })}
      ${tile("Fichier d'échange", "—", { id: "l-swap", meter: meter(0) })}
      ${tile("Disques", "—", { id: "l-disk" })}
      ${tile("Réseau", "—", { id: "l-net" })}
      ${tile("Processus", "—", { id: "l-proc" })}
    </div>
    <div id="l-bat-wrap"></div>
    <div class="row" style="margin-bottom:12px"><span class="small text-2">Fenêtre affichée</span>${seg(WINDOWS, "300")}</div>
    <div class="grid cols-2">
      ${card("Processeur", html`<div class="chart"><canvas id="c-cpu"></canvas></div>`, { sub: "Utilisation totale, en %" })}
      ${card("Mémoire vive", html`<div class="chart"><canvas id="c-ram"></canvas></div>`, { sub: "Part de la RAM utilisée, en %" })}
      ${card("Disques", html`<div class="legend">${raw(legend([["Lecture", c.series[0]], ["Écriture", c.series[1]]], "line"))}</div><div class="chart"><canvas id="c-disk"></canvas></div>`, { sub: "Débit total, tous disques" })}
      ${card("Réseau", html`<div class="legend">${raw(legend([["Réception", c.series[2]], ["Envoi", c.series[6]]], "line"))}</div><div class="chart"><canvas id="c-net"></canvas></div>`, { sub: "Débit total, toutes interfaces" })}
      ${card("Charge par cœur logique", html`<div class="chart short"><canvas id="c-cores"></canvas></div>`, { cls: "span-all", sub: "Dernière mesure, en %" })}
    </div>`);
  bindSeg(el, ".row .seg", (v) => { windowSec = Number(v); tick(); });

  const pct = (v) => `${v} %`;
  const cpu = ctx.chart(timeLine(el.querySelector("#c-cpu"), { series: [{ label: "Processeur", color: c.series[0], data: [], area: true }], yMax: 100, yFormat: pct, tooltipFormat: (v) => fmtPct(v, 1) }));
  const ram = ctx.chart(timeLine(el.querySelector("#c-ram"), { series: [{ label: "Mémoire", color: c.series[1], data: [], area: true }], yMax: 100, yFormat: pct, tooltipFormat: (v) => fmtPct(v, 1) }));
  const disk = ctx.chart(timeLine(el.querySelector("#c-disk"), { series: [{ label: "Lecture", color: c.series[0], data: [] }, { label: "Écriture", color: c.series[1], data: [] }], yFormat: (v) => fmtRate(v) }));
  const net = ctx.chart(timeLine(el.querySelector("#c-net"), { series: [{ label: "Réception", color: c.series[2], data: [] }, { label: "Envoi", color: c.series[6], data: [] }], yFormat: (v) => fmtRate(v) }));
  let cores = null;
  const all = [];

  const set = (id, value, hint, pctVal, opts) => {
    const t = el.querySelector(`#${id}`);
    if (!t) return;
    setHTML(t.querySelector('[data-role="value"]'), value);
    if (hint !== undefined) t.querySelector('[data-role="hint"]').textContent = hint;
    const m = t.querySelector(".meter");
    if (m && pctVal !== undefined) m.outerHTML = String(meter(pctVal, opts));
  };

  let last = 0;
  let info = null;
  async function tick() {
    try {
      const r = await ctx.api.get("live", { since: last });
      if (!ctx.alive()) return;
      info = r.info;
      for (const p of r.points) all.push(p);
      if (r.points.length) last = r.points[r.points.length - 1].t;
    } catch { return; }
    const cut = Date.now() - windowSec * 1000;
    while (all.length && all[0].t * 1000 < cut - 600000) all.shift(); // garde 10 min max
    const pts = all.filter((p) => p.t * 1000 >= cut);
    const put = (chart, keys) => {
      keys.forEach((k, i) => { chart.data.datasets[i].data = pts.map((p) => ({ x: p.t * 1000, y: p[k] })); });
      chart.options.scales.x.min = cut;
      chart.options.scales.x.max = Date.now();
      chart.update("none");
    };
    put(cpu, ["cpu"]); put(ram, ["ram"]); put(disk, ["disk_r", "disk_w"]); put(net, ["net_down", "net_up"]);

    const p = all[all.length - 1];
    if (!p || !info) return;
    if (!cores) {
      cores = ctx.chart(bars(el.querySelector("#c-cores"), {
        labels: p.cores.map((_, i) => `${i}`), datasets: [{ label: "Charge", data: p.cores, color: c.series[0] }],
        max: 100, format: (v) => `${v} %`,
      }));
    } else {
      cores.data.datasets[0].data = p.cores;
      cores.update("none");
    }
    const avg = pts.length ? pts.reduce((s, x) => s + x.cpu, 0) / pts.length : p.cpu;
    set("l-cpu", fmtPct(p.cpu), `moyenne ${fmtPct(avg)} · ${info.freq && info.freq.current ? `${fmtNum(info.freq.current / 1000, 2)} GHz` : `${info.cpu_logical} threads`}`, p.cpu);
    set("l-ram", fmtPct(p.ram), `${fmtBytes(p.ram_used)} / ${fmtBytes(info.ram_total)}`, p.ram, { warn: 80, crit: 92 });
    set("l-swap", fmtPct(p.swap), `${fmtBytes(info.swap_used)} / ${fmtBytes(info.swap_total)}`, p.swap, { warn: 70, crit: 90 });
    set("l-disk", fmtRate(p.disk_r + p.disk_w), `lecture ${fmtRate(p.disk_r)} · écriture ${fmtRate(p.disk_w)}`);
    set("l-net", fmtRate(p.net_down + p.net_up), `↓ ${fmtRate(p.net_down)} · ↑ ${fmtRate(p.net_up)}`);
    set("l-proc", fmtNum(info.process_count), `allumé depuis ${fmtDuration(info.uptime)}`);
    const b = info.battery;
    const wrap = el.querySelector("#l-bat-wrap");
    if (b && wrap && !wrap.dataset.done) {
      wrap.dataset.done = "1";
      wrap.className = "grid cols-6";
      wrap.innerHTML = String(tile("Batterie", fmtPct(b.percent), { id: "l-bat", hint: b.plugged ? "sur secteur" : b.secsleft ? `${fmtDuration(b.secsleft)} restantes` : "sur batterie", meter: meter(b.percent, { invert: true, warn: 70, crit: 85 }) }));
    } else if (b) {
      set("l-bat", fmtPct(b.percent), b.plugged ? "sur secteur" : b.secsleft ? `${fmtDuration(b.secsleft)} restantes` : "sur batterie", b.percent, { invert: true, warn: 70, crit: 85 });
    }
  }
  tick();
  ctx.every(2000, tick);
}

// ---------------------------------------------------------------------- historique
function history(el, ctx) {
  setHTML(el, html`
    <div class="row" style="margin-bottom:14px">${seg([["1h", "1 heure"], ["24h", "24 heures"], ["7d", "7 jours"], ["30d", "30 jours"]], "24h")}
      <span class="small muted">Mesures enregistrées uniquement quand PC Insight est ouvert (ou lancé avec --collect).</span></div>
    <div id="h-body">${loading()}</div>`);
  const charts = [];
  const load = async (range) => {
    charts.splice(0).forEach((ch) => ch.destroy());
    const body = el.querySelector("#h-body");
    let h;
    try { h = await ctx.api.get("history", { range }); } catch (e) { setHTML(body, errorBox(e.message)); return; }
    if (!ctx.alive()) return;
    const st = h.stats;
    if (!st.minutes) {
      setHTML(body, card("Pas encore d'historique", html`<p class="text-2">L'historique se remplit au fil de l'utilisation (une mesure moyenne par minute, conservée 30 jours). Revenez dans quelques minutes.</p>`));
      return;
    }
    const c = colors();
    const longRange = range === "7d" || range === "30d";
    const xFormat = (v, full) => {
      const d = new Date(v);
      return longRange || full ? d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
        : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    };
    setHTML(body, html`
      <div class="grid cols-auto">
        ${tile("CPU moyen", fmtPct(st.cpu_avg), { hint: `95e centile : ${fmtPct(st.cpu_p95)}` })}
        ${tile("CPU maximum", fmtPct(st.cpu_max), { hint: `${fmtNum(st.cpu_high_minutes)} min au-dessus de 80 %` })}
        ${tile("RAM moyenne", fmtPct(st.ram_avg), { hint: `maximum ${fmtPct(st.ram_max)}` })}
        ${tile("Données réseau", fmtBytes(st.net_down + st.net_up), { hint: `↓ ${fmtBytes(st.net_down)} · ↑ ${fmtBytes(st.net_up)}` })}
        ${tile("Disques", fmtBytes(st.disk_read + st.disk_write), { hint: `lus ${fmtBytes(st.disk_read)} · écrits ${fmtBytes(st.disk_write)}` })}
        ${tile("Couverture", fmtPct(Math.min(100, st.coverage)), { hint: `${fmtNum(st.minutes)} minutes enregistrées` })}
      </div>
      <div class="grid cols-2">
        ${card("Processeur", html`<div class="legend">${raw(legend([["Moyenne", c.series[0]], ["Pic", c.series[7]]], "line"))}</div><div class="chart"><canvas id="h-cpu"></canvas></div>`, { sub: "Moyenne et pic par intervalle, en %" })}
        ${card("Mémoire vive", html`<div class="chart"><canvas id="h-ram"></canvas></div>`, { sub: "Utilisation moyenne, en %" })}
        ${card("Profil horaire", html`<div class="chart"><canvas id="h-hour"></canvas></div>`, { sub: "CPU moyen selon l'heure de la journée" })}
        ${card("Espace disque utilisé", html`<div class="legend" id="h-disk-legend"></div><div class="chart"><canvas id="h-disk"></canvas></div>`, { sub: "Par volume, en % (une mesure par heure)" })}
      </div>`);
    const gap = h.bucket * 1000 * 2.5; // pas de trait entre deux sessions éloignées
    const pts = (k) => h.series.map((p) => ({ x: p.t * 1000, y: p[k] }));
    charts.push(ctx.chart(timeLine(body.querySelector("#h-cpu"), {
      series: [{ label: "Moyenne", color: c.series[0], data: pts("cpu"), area: true, spanGaps: gap }, { label: "Pic", color: c.series[7], data: pts("cpu_max"), spanGaps: gap }],
      yMax: 100, yFormat: (v) => `${v} %`, tooltipFormat: (v) => fmtPct(v, 1), xFormat,
    })));
    charts.push(ctx.chart(timeLine(body.querySelector("#h-ram"), {
      series: [{ label: "Mémoire", color: c.series[1], data: pts("ram"), area: true, spanGaps: gap }],
      yMax: 100, yFormat: (v) => `${v} %`, tooltipFormat: (v) => fmtPct(v, 1), xFormat,
    })));
    charts.push(ctx.chart(bars(body.querySelector("#h-hour"), {
      labels: h.hourly.map((x) => `${x.hour} h`), datasets: [{ label: "CPU moyen", data: h.hourly.map((x) => x.cpu), color: c.series[0] }],
      format: (v) => fmtPct(v, 1), maxTicks: 12,
    })));
    const mounts = Object.keys(h.disk);
    const diskCanvas = body.querySelector("#h-disk");
    if (mounts.length && mounts.some((m) => h.disk[m].length > 1)) {
      setHTML(body.querySelector("#h-disk-legend"), raw(legend(mounts.map((m, i) => [m, c.series[i % 8]]), "line")));
      charts.push(ctx.chart(timeLine(diskCanvas, {
        series: mounts.slice(0, 8).map((m, i) => ({ label: m, color: c.series[i], data: h.disk[m].map((p) => ({ x: p.t * 1000, y: (100 * p.used) / p.total })), spanGaps: 4 * 3600000 })),
        yMax: 100, yFormat: (v) => `${v} %`, tooltipFormat: (v) => fmtPct(v, 1), xFormat,
      })));
    } else {
      diskCanvas.parentElement.outerHTML = '<div class="empty">Il faut au moins deux mesures horaires pour tracer l\'évolution.</div>';
    }
  };
  bindSeg(el, ".row .seg", load);
  load("24h");
}

// ---------------------------------------------------------------------- processus
function proc(el, ctx) {
  const c = colors();
  setHTML(el, html`
    <div class="grid cols-3">
      ${card("Processus", html`<div id="p-table">${loading("Mesure de l'activité des processus…")}</div>`, { cls: "span-2", sub: "Regroupés par nom, actualisés toutes les 3 s. CPU en % de la capacité totale." })}
      ${card("Plus gros consommateurs de mémoire", html`<div class="chart tall"><canvas id="p-mem"></canvas></div>`, { sub: "Mémoire utilisée (working set)" })}
    </div>`);
  let table = null;
  let chart = null;
  const tick = async () => {
    let r;
    try { r = await ctx.api.get("processes"); } catch (e) { if (!table) setHTML(el.querySelector("#p-table"), errorBox(e.message)); return; }
    if (!ctx.alive()) return;
    if (!table) {
      table = new DataTable(el.querySelector("#p-table"), {
        rows: r.rows, sortKey: "cpu", sortDir: "desc", pageSize: 30,
        columns: [
          { key: "name", label: "Nom" },
          { key: "count", label: "Instances", num: true },
          { key: "cpu", label: "CPU", num: true, render: (p) => fmtPct(p.cpu, 1) },
          { key: "memory", label: "Mémoire", num: true, render: (p) => fmtBytes(p.memory) },
          { key: "threads", label: "Threads", num: true },
          { key: "user", label: "Utilisateur", render: (p) => (p.user ? p.user.split("\\").pop() : "—") },
        ],
      });
    } else {
      table.rows = r.rows;
      table.renderBody();
    }
    const top = r.top_memory;
    if (!chart) {
      chart = ctx.chart(bars(el.querySelector("#p-mem"), {
        labels: top.map((p) => p.name), datasets: [{ label: "Mémoire", data: top.map((p) => p.memory), color: c.series[1] }],
        horizontal: true, format: (v) => fmtBytes(v, 0),
      }));
    } else {
      chart.data.labels = top.map((p) => p.name);
      chart.data.datasets[0].data = top.map((p) => p.memory);
      chart.update("none");
    }
  };
  tick();
  ctx.every(3000, tick);
}
