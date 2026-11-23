import { bars, colors, legend, timeLine } from "../charts.js";
import {
  DataTable, GLOSSARY, bindSeg, card, errorBox, fmtBytes, fmtDuration, fmtMHz, fmtNum, fmtPct, fmtRate, fmtTemp, help, html, kv,
  level, loading, meter, raw, seg, setHTML, summary, tile,
} from "../ui.js";

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
    <div id="l-sum"></div>
    <div class="grid cols-6">
      ${tile("Processeur", "—", { id: "l-cpu", meter: meter(0), tip: GLOSSARY.realFreq })}
      ${tile("Mémoire vive", "—", { id: "l-ram", meter: meter(0) })}
      ${tile("Carte graphique", "—", { id: "l-gpu", meter: meter(0), tip: GLOSSARY.gpuLoad })}
      ${tile("Activité disque", "—", { id: "l-disk", meter: meter(0), tip: GLOSSARY.diskBusy })}
      ${tile("Réseau", "—", { id: "l-net" })}
      ${tile("Fichier d'échange", "—", { id: "l-swap", meter: meter(0), tip: GLOSSARY.swap })}
    </div>
    <div id="l-bat-wrap"></div>
    <div class="row" style="margin-bottom:12px"><span class="small text-2">Période affichée</span>${seg(WINDOWS, "300")}</div>
    <div class="grid cols-2">
      ${card("Processeur", html`<div class="chart"><canvas id="c-cpu"></canvas></div>`, { ico: "cpu", sub: "Utilisation totale, en %" })}
      ${card("Mémoire vive", html`<div class="chart"><canvas id="c-ram"></canvas></div>`, { ico: "memory", sub: "Part de la RAM utilisée, en %" })}
      ${card("Carte graphique", html`<div class="chart"><canvas id="c-gpu"></canvas></div>`, { ico: "gpu", sub: "Charge du moteur le plus occupé, en %" })}
      ${card("Disques", html`<div class="legend">${raw(legend([["Lecture", c.series[0]], ["Écriture", c.series[1]]], "line"))}</div><div class="chart"><canvas id="c-disk"></canvas></div>`, { ico: "disk", sub: "Débit total, tous disques" })}
      ${card("Réseau", html`<div class="legend">${raw(legend([["Réception", c.series[2]], ["Envoi", c.series[6]]], "line"))}</div><div class="chart"><canvas id="c-net"></canvas></div>`, { ico: "network", sub: "Débit total, toutes interfaces" })}
      ${card("Charge par cœur logique", html`<div class="chart"><canvas id="c-cores"></canvas></div>`, { ico: "cpu", sub: "Dernière mesure, en % — un cœur à 100 % peut brider une application même si la moyenne est basse" })}
    </div>
    <div class="grid cols-2">
      ${card("Activité de chaque disque", html`<div id="l-disks" class="empty">Mesure indisponible sur ce système.</div>`, { ico: "disk", tip: GLOSSARY.latency })}
      ${card("Détail de la mémoire", html`<div id="l-mem" class="empty">Mesure indisponible sur ce système.</div>`, { ico: "memory", tip: GLOSSARY.commit })}
    </div>`);
  bindSeg(el, ".row .seg", (v) => { windowSec = Number(v); tick(); });

  const pct = (v) => `${v} %`;
  const line = (id, label, color, area = true) => ctx.chart(timeLine(el.querySelector(id), { series: [{ label, color, data: [], area }], yMax: 100, yFormat: pct, tooltipFormat: (v) => fmtPct(v, 1) }));
  const cpu = line("#c-cpu", "Processeur", c.series[0]);
  const ram = line("#c-ram", "Mémoire", c.series[1]);
  const gpu = line("#c-gpu", "Carte graphique", c.series[2]);
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
    if (m && pctVal !== undefined && pctVal !== null) m.outerHTML = String(meter(pctVal, opts));
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
      keys.forEach((k, i) => { chart.data.datasets[i].data = pts.filter((p) => p[k] !== null && p[k] !== undefined).map((p) => ({ x: p.t * 1000, y: p[k] })); });
      chart.options.scales.x.min = cut;
      chart.options.scales.x.max = Date.now();
      chart.update("none");
    };
    put(cpu, ["cpu"]); put(ram, ["ram"]); put(gpu, ["gpu"]); put(disk, ["disk_r", "disk_w"]); put(net, ["net_down", "net_up"]);

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
    const avg = (k) => { const v = pts.map((x) => x[k]).filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const cpuAvg = avg("cpu"), ramAvg = avg("ram"), gpuAvg = avg("gpu"), diskAvg = avg("disk_busy");
    const freq = p.cpu_mhz || (info.freq && info.freq.current);
    const hot = Math.max(...p.cores);
    setHTML(el.querySelector("#l-sum"), summary([
      { kind: level(cpuAvg, 70, 90) || "good", title: `Processeur : ${cpuAvg < 25 ? "peu sollicité" : cpuAvg < 70 ? "moyennement sollicité" : "très sollicité"}`,
        text: `${fmtPct(cpuAvg)} en moyenne${hot >= 95 && cpuAvg < 50 ? ` — un cœur est saturé (${fmtPct(hot)}) : une application ne tourne que sur un seul cœur` : ""}.` },
      { kind: level(ramAvg, 80, 92) || "good", title: `Mémoire : ${ramAvg < 60 ? "confortable" : ramAvg < 85 ? "bien utilisée" : "presque pleine"}`,
        text: `${fmtPct(ramAvg)} utilisée en moyenne, ${fmtBytes(info.ram_available)} encore disponibles.` },
      gpuAvg !== null ? { kind: "info", title: `Carte graphique : ${fmtPct(gpuAvg)} en moyenne`, text: gpuAvg < 10 ? "Au repos." : "En cours d'utilisation (jeu, vidéo, calcul)." } : null,
      diskAvg !== null ? { kind: level(diskAvg, 60, 90) || "good", title: `Disques : ${diskAvg < 30 ? "calmes" : diskAvg < 60 ? "actifs" : "saturés"}`, text: `Activité maximale moyenne ${fmtPct(diskAvg)}.` } : null,
    ]));
    set("l-cpu", fmtPct(p.cpu), [freq ? fmtMHz(freq) : `${info.cpu_logical} threads`, p.cpu_temp ? fmtTemp(p.cpu_temp) : `moyenne ${fmtPct(cpuAvg)}`].join(" · "), p.cpu);
    set("l-ram", fmtPct(p.ram), `${fmtBytes(p.ram_used)} / ${fmtBytes(info.ram_total)}`, p.ram, { warn: 80, crit: 92 });
    set("l-gpu", p.gpu === null || p.gpu === undefined ? "—" : fmtPct(p.gpu), p.gpu === null || p.gpu === undefined ? "mesure indisponible" : [p.gpu_mem ? `${fmtBytes(p.gpu_mem)} VRAM` : "", p.gpu_temp ? fmtTemp(p.gpu_temp) : ""].filter(Boolean).join(" · ") || " ", p.gpu ?? 0);
    set("l-disk", p.disk_busy === null || p.disk_busy === undefined ? fmtRate(p.disk_r + p.disk_w) : fmtPct(p.disk_busy), `lecture ${fmtRate(p.disk_r)} · écriture ${fmtRate(p.disk_w)}`, p.disk_busy ?? 0, { warn: 60, crit: 90 });
    set("l-net", fmtRate(p.net_down + p.net_up), `↓ ${fmtRate(p.net_down)} · ↑ ${fmtRate(p.net_up)}`);
    set("l-swap", fmtPct(p.swap), `${fmtBytes(info.swap_used)} / ${fmtBytes(info.swap_total)}`, p.swap, { warn: 70, crit: 90 });
    const b = info.battery;
    const wrap = el.querySelector("#l-bat-wrap");
    if (b && wrap && !wrap.dataset.done) {
      wrap.dataset.done = "1";
      wrap.className = "grid cols-6";
      wrap.innerHTML = String(tile("Batterie", fmtPct(b.percent), { id: "l-bat", ico: "battery", hint: b.plugged ? "sur secteur" : b.secsleft ? `${fmtDuration(b.secsleft)} restantes` : "sur batterie", meter: meter(b.percent, { invert: true, warn: 70, crit: 85 }) }));
    } else if (b) {
      set("l-bat", fmtPct(b.percent), b.plugged ? "sur secteur" : b.secsleft ? `${fmtDuration(b.secsleft)} restantes` : "sur batterie", b.percent, { invert: true, warn: 70, crit: 85 });
    }
  }

  // détails issus des compteurs Windows (disques, mémoire), toutes les 4 s
  async function details() {
    let r;
    try { r = await ctx.api.get("counters"); } catch { return; }
    if (!ctx.alive() || !r.data) return;
    const d = r.data;
    if (d.disks && d.disks.length) {
      setHTML(el.querySelector("#l-disks"), html`${d.disks.map((x) => html`<div class="volume">
        <div class="top"><span class="name">Disque ${x.name}</span><span class="small text-2">temps de réponse ${fmtNum(x.latency_ms, 1)} ms · file d'attente ${fmtNum(x.queue, 0)}</span></div>
        ${meter(x.busy, { warn: 60, crit: 90 })}
        <div class="small muted">${fmtPct(x.busy)} d'activité</div></div>`)}`);
      el.querySelector("#l-disks").classList.remove("empty");
    }
    const m = d.memory || {};
    if (m.committed) {
      setHTML(el.querySelector("#l-mem"), kv([
        ["Mémoire engagée", html`${fmtBytes(m.committed)} sur ${fmtBytes(m.commit_limit)} ${help(GLOSSARY.commit)}`],
        ["En cache", html`${fmtBytes(m.cache)} ${help(GLOSSARY.cache)}`],
        ["Pool paginé / non paginé", `${fmtBytes(m.pool_paged)} / ${fmtBytes(m.pool_nonpaged)}`],
        ["Lectures du fichier d'échange", `${fmtNum(m.pages_input, 0)} pages/s`],
        ["Threads / handles", d.threads ? `${fmtNum(d.threads)} / ${fmtNum(d.handles)}` : null],
        ["File d'attente du processeur", d.queue !== undefined ? fmtNum(d.queue) : null],
      ]));
      el.querySelector("#l-mem").classList.remove("empty");
    }
  }
  tick();
  details();
  ctx.every(2000, tick);
  ctx.every(4000, details);
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
        ${tile("CPU moyen", fmtPct(st.cpu_avg), { hint: `95e centile : ${fmtPct(st.cpu_p95)}`, tip: GLOSSARY.p95 })}
        ${tile("CPU maximum", fmtPct(st.cpu_max), { hint: `${fmtNum(st.cpu_high_minutes)} min au-dessus de 80 %` })}
        ${tile("RAM moyenne", fmtPct(st.ram_avg), { hint: `maximum ${fmtPct(st.ram_max)}` })}
        ${tile("Données réseau", fmtBytes(st.net_down + st.net_up), { hint: `↓ ${fmtBytes(st.net_down)} · ↑ ${fmtBytes(st.net_up)}` })}
        ${tile("Disques", fmtBytes(st.disk_read + st.disk_write), { hint: `lus ${fmtBytes(st.disk_read)} · écrits ${fmtBytes(st.disk_write)}` })}
        ${st.gpu_avg !== null && st.gpu_avg !== undefined ? tile("GPU moyen", fmtPct(st.gpu_avg), { hint: `95e centile : ${fmtPct(st.gpu_p95)}` }) : ""}
        ${st.cpu_temp_max ? tile("Température CPU max", fmtTemp(st.cpu_temp_max), { hint: `moyenne ${fmtTemp(st.cpu_temp_avg)}` }) : ""}
        ${tile("Couverture", fmtPct(Math.min(100, st.coverage)), { hint: `${fmtNum(st.minutes)} minutes enregistrées`, tip: "Part de la période pendant laquelle PC Insight tournait et a pu mesurer." })}
      </div>
      <div class="grid cols-2">
        ${card("Processeur", html`<div class="legend">${raw(legend([["Moyenne", c.series[0]], ["Pic", c.series[7]]], "line"))}</div><div class="chart"><canvas id="h-cpu"></canvas></div>`, { sub: "Moyenne et pic par intervalle, en %" })}
        ${card("Mémoire vive", html`<div class="chart"><canvas id="h-ram"></canvas></div>`, { sub: "Utilisation moyenne, en %" })}
        ${card("Carte graphique", html`<div class="chart"><canvas id="h-gpu"></canvas></div>`, { sub: "Charge moyenne, en %" })}
        ${card("Températures", html`<div class="legend">${raw(legend([["Processeur", c.series[1]], ["Carte graphique", c.series[0]]], "line"))}</div><div class="chart"><canvas id="h-temp"></canvas></div>`, { sub: "Moyenne par intervalle, en °C (capteurs disponibles uniquement)" })}
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
    const hasGpu = h.series.some((p) => p.gpu !== null && p.gpu !== undefined);
    const hasTemp = h.series.some((p) => p.cpu_temp || p.gpu_temp);
    const ptsNN = (k) => h.series.filter((p) => p[k] !== null && p[k] !== undefined).map((p) => ({ x: p.t * 1000, y: p[k] }));
    if (hasGpu) {
      charts.push(ctx.chart(timeLine(body.querySelector("#h-gpu"), {
        series: [{ label: "Carte graphique", color: c.series[2], data: ptsNN("gpu"), area: true, spanGaps: gap }],
        yMax: 100, yFormat: (v) => `${v} %`, tooltipFormat: (v) => fmtPct(v, 1), xFormat,
      })));
    } else {
      body.querySelector("#h-gpu").parentElement.outerHTML = '<div class="empty">Pas de mesure GPU enregistrée sur cette période.</div>';
    }
    if (hasTemp) {
      charts.push(ctx.chart(timeLine(body.querySelector("#h-temp"), {
        series: [{ label: "Processeur", color: c.series[1], data: ptsNN("cpu_temp"), spanGaps: gap }, { label: "Carte graphique", color: c.series[0], data: ptsNN("gpu_temp"), spanGaps: gap }],
        yFormat: (v) => `${v} °C`, tooltipFormat: (v) => fmtTemp(v), xFormat,
      })));
    } else {
      body.querySelector("#h-temp").parentElement.outerHTML = '<div class="empty">Aucune température enregistrée (voir la page Capteurs).</div>';
    }
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
      ${card("Processus", html`<div id="p-table">${loading("Mesure de l'activité des processus…")}</div>`, { cls: "span-2", ico: "activity", sub: "Regroupés par nom, actualisés toutes les 3 s. CPU en % de la capacité totale du processeur." })}
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
          { key: "memory", label: html`Mémoire${help(GLOSSARY.workingSet)}`, num: true, render: (p) => fmtBytes(p.memory) },
          { key: "threads", label: "Threads", num: true },
          { key: "user", label: "Utilisateur", render: (p) => (p.user ? p.user.split("\\").pop() : "—") },
          { key: "path", label: "Emplacement", cls: "mono clip", render: (p) => (p.path ? html`<span title="${p.path}">${p.path}</span>` : "—") },
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
