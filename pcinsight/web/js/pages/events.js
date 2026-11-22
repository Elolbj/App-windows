import { bars, colors, legend, timeLine } from "../charts.js";
import { DataTable, badge, bindSeg, card, errorBox, fmtDateTime, fmtNum, html, loading, raw, scriptNotes, seg, setHTML, tile } from "../ui.js";

const LEVEL = { 1: ["Critique", "critical"], 2: ["Erreur", "serious"], 3: ["Avertissement", "warning"] };
const KIND_LABEL = {
  bsod: "Écran bleu", unexpected_reboot: "Redémarrage inattendu", unexpected_shutdown: "Arrêt inattendu",
  hardware: "Erreur matérielle", disk: "Erreur disque", low_memory: "Mémoire insuffisante", dump: "Vidage mémoire",
};
const PERIODS = [["1", "24 heures"], ["7", "7 jours"], ["30", "30 jours"]];

const levelBadge = (l) => badge(...(LEVEL[l] || ["?", ""]));

/** Agrège les événements d'une période (24 h -> par heure, sinon par jour). */
function aggregate(events, days) {
  const now = new Date();
  const hourly = days === 1;
  const keys = [];
  if (hourly) {
    for (let i = 23; i >= 0; i--) { const d = new Date(now.getTime() - i * 3600000); d.setMinutes(0, 0, 0); keys.push(d.getTime()); }
  } else {
    for (let i = days - 1; i >= 0; i--) { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); keys.push(d.getTime()); }
  }
  const buckets = new Map(keys.map((k) => [k, { 1: 0, 2: 0, 3: 0 }]));
  const sources = new Map();
  const groups = new Map();
  const crashes = new Map();
  for (const e of events) {
    const t = new Date(e.time);
    if (hourly) t.setMinutes(0, 0, 0); else t.setHours(0, 0, 0, 0);
    const b = buckets.get(t.getTime());
    if (b) b[e.level] += 1;
    sources.set(e.source, (sources.get(e.source) || 0) + 1);
    const key = `${e.source}|${e.id}`;
    const g = groups.get(key) || { source: e.source, id: e.id, level: e.level, count: 0, last: e.time, message: e.message };
    g.count += 1;
    g.level = Math.min(g.level, e.level);
    if (!g.message && e.message) g.message = e.message;
    groups.set(key, g);
    if (e.kind === "app_crash" || e.kind === "app_hang") crashes.set(e.app || "?", (crashes.get(e.app || "?") || 0) + 1);
  }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  return {
    hourly, keys, buckets,
    sources: top(sources, 10),
    groups: [...groups.values()].sort((a, b) => b.count - a.count),
    crashes: top(crashes, 10),
  };
}

export default {
  title: "Événements",
  subtitle: "Erreurs et avertissements des journaux Système et Application",

  async render(view, ctx) {
    setHTML(view, loading("Lecture des journaux d'événements… (10 à 30 s au premier lancement)"));
    let r;
    try { r = await ctx.api.section("events", ctx.refresh); } catch (e) { setHTML(view, errorBox(e.message)); return; }
    if (!ctx.alive()) return;
    const all = r.data.events;
    const st = r.data.stats;
    const c = colors();

    setHTML(view, html`
      ${r.data.truncated ? html`<div class="banner">Beaucoup d'événements : seuls les ${fmtNum(all.length)} plus récents sont analysés.</div>` : ""}
      <div class="row" style="margin-bottom:14px">${seg(PERIODS, "7")}<span class="spacer"></span>
        <select id="lvl" aria-label="Niveau"><option value="">Tous les niveaux</option><option value="1">Critiques</option><option value="2">Erreurs</option><option value="3">Avertissements</option></select></div>
      <div id="body"></div>
      ${scriptNotes(r.data.errors, ctx.status.admin)}`);

    let days = 7;
    let level = "";
    let charts = [];
    const draw = () => {
      charts.forEach((ch) => ch.destroy());
      charts = [];
      const since = Date.now() - days * 86400000;
      const evs = all.filter((e) => new Date(e.time).getTime() >= since && (!level || String(e.level) === level));
      const agg = aggregate(evs, days);
      const count = (l) => evs.filter((e) => e.level === l).length;
      const incidents = (st.incidents || []).filter((i) => new Date(i.time).getTime() >= since);
      const crashCount = evs.filter((e) => e.kind === "app_crash" || e.kind === "app_hang").length;
      const unexpected = incidents.filter((i) => i.kind === "unexpected_reboot" || i.kind === "unexpected_shutdown" || i.kind === "bsod").length;
      const rel = (st.reliability || []).filter((p) => new Date(p.time).getTime() >= since - 86400000);
      const relLast = rel.length ? rel[rel.length - 1].index : st.reliability_last;
      const body = view.querySelector("#body");

      setHTML(body, html`
        <div class="grid cols-6">
          ${tile("Critiques", fmtNum(count(1)), { hint: "niveau 1" })}
          ${tile("Erreurs", fmtNum(count(2)), { hint: `${fmtNum(count(2) / days, 1)} par jour` })}
          ${tile("Avertissements", fmtNum(count(3)), { hint: `${fmtNum(count(3) / days, 1)} par jour` })}
          ${tile("Plantages d'applications", fmtNum(crashCount), { hint: agg.crashes[0] ? `surtout ${agg.crashes[0][0]}` : "aucun" })}
          ${tile("Arrêts brutaux / écrans bleus", fmtNum(unexpected), { hint: unexpected ? "voir incidents" : "aucun" })}
          ${tile("Indice de fiabilité", relLast !== null && relLast !== undefined ? fmtNum(relLast, 1) : "—", { unit: relLast !== null && relLast !== undefined ? "/10" : "", hint: "calculé par Windows" })}
        </div>
        <div class="grid cols-3">
          ${card(agg.hourly ? "Événements par heure" : "Événements par jour", html`<div class="legend">${raw(legend([["Critique", c.critical], ["Erreur", c.serious], ["Avertissement", c.warning]]))}</div><div class="chart"><canvas id="c-days"></canvas></div>`, { cls: "span-2" })}
          ${card("Sources principales", html`<div class="chart"><canvas id="c-src"></canvas></div>`, { sub: "Nombre d'événements" })}
        </div>
        <div class="grid cols-3">
          ${card("Indice de stabilité", html`<div class="chart"><canvas id="c-rel"></canvas></div>`, { cls: "span-2", sub: "Moniteur de fiabilité Windows (10 = aucun incident)" })}
          ${card("Applications qui plantent", agg.crashes.length ? html`<div class="chart"><canvas id="c-crash"></canvas></div>` : html`<div class="empty">Aucun plantage d'application sur la période.</div>`, { sub: "Événements 1000 / 1002" })}
        </div>
        <div class="grid">${card("Incidents système", html`<div id="t-inc"></div>`, { sub: "Écrans bleus, arrêts inattendus, erreurs disque et matérielles" })}</div>
        <div class="grid">${card("Événements les plus fréquents", html`<div id="t-groups"></div>`, { sub: "Regroupés par source et identifiant" })}</div>
        <div class="grid">${card("Tous les événements", html`<div id="t-all"></div>`)}</div>`);

      const labelFor = (k) => (agg.hourly ? `${new Date(k).getHours()} h` : new Date(k).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }));
      charts.push(ctx.chart(bars(body.querySelector("#c-days"), {
        labels: agg.keys.map(labelFor), stacked: true, maxTicks: 12,
        datasets: [
          { label: "Critique", data: agg.keys.map((k) => agg.buckets.get(k)[1]), color: c.critical },
          { label: "Erreur", data: agg.keys.map((k) => agg.buckets.get(k)[2]), color: c.serious },
          { label: "Avertissement", data: agg.keys.map((k) => agg.buckets.get(k)[3]), color: c.warning },
        ],
      })));
      charts.push(ctx.chart(bars(body.querySelector("#c-src"), {
        labels: agg.sources.map(([s]) => s.replace("Microsoft-Windows-", "")), datasets: [{ label: "Événements", data: agg.sources.map(([, n]) => n), color: c.series[0] }], horizontal: true,
      })));
      if (agg.crashes.length) {
        charts.push(ctx.chart(bars(body.querySelector("#c-crash"), {
          labels: agg.crashes.map(([a]) => a), datasets: [{ label: "Plantages", data: agg.crashes.map(([, n]) => n), color: c.series[1] }], horizontal: true,
        })));
      }
      const relCanvas = body.querySelector("#c-rel");
      if (rel.length > 1) {
        const fmt = (v, full) => new Date(v).toLocaleString("fr-FR", full ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit" });
        charts.push(ctx.chart(timeLine(relCanvas, {
          series: [{ label: "Indice", color: c.series[0], data: rel.map((p) => ({ x: new Date(p.time).getTime(), y: p.index })), area: true, spanGaps: true }],
          yMax: 10, yFormat: (v) => fmtNum(v), tooltipFormat: (v) => `${fmtNum(v, 2)} / 10`, xFormat: fmt,
        })));
      } else {
        relCanvas.parentElement.outerHTML = '<div class="empty">Indice indisponible (service « Analyse de fiabilité » désactivé ou historique vide).</div>';
      }

      new DataTable(body.querySelector("#t-inc"), {
        rows: incidents, search: false, sortKey: "time", sortDir: "desc", empty: "Aucun incident système sur la période.",
        columns: [
          { key: "time", label: "Date", cls: "nowrap", render: (i) => fmtDateTime(i.time) },
          { key: "kind", label: "Type", render: (i) => badge(KIND_LABEL[i.kind] || i.label, i.kind === "bsod" || i.kind === "hardware" || i.kind === "disk" ? "critical" : "warning") },
          { key: "source", label: "Source" },
          { key: "id", label: "ID", num: true },
          { key: "message", label: "Détail", cls: "wrap", render: (i) => i.message || i.label },
        ],
      });
      new DataTable(body.querySelector("#t-groups"), {
        rows: agg.groups, sortKey: "count", sortDir: "desc", pageSize: 15,
        columns: [
          { key: "level", label: "Niveau", render: (g) => levelBadge(g.level) },
          { key: "source", label: "Source" },
          { key: "id", label: "ID", num: true },
          { key: "count", label: "Nombre", num: true },
          { key: "last", label: "Dernier", cls: "nowrap", render: (g) => fmtDateTime(g.last) },
          { key: "message", label: "Message", cls: "wrap", render: (g) => g.message || "—" },
        ],
      });
      new DataTable(body.querySelector("#t-all"), {
        rows: evs, sortKey: "time", sortDir: "desc", pageSize: 50,
        columns: [
          { key: "time", label: "Date", cls: "nowrap", render: (e) => fmtDateTime(e.time) },
          { key: "level", label: "Niveau", render: (e) => levelBadge(e.level) },
          { key: "log", label: "Journal" },
          { key: "source", label: "Source" },
          { key: "id", label: "ID", num: true },
          { key: "message", label: "Message", cls: "wrap", render: (e) => e.message || html`<span class="muted">(voir l'Observateur d'événements)</span>` },
        ],
      });
    };
    bindSeg(view, ".row .seg", (v) => { days = Number(v); draw(); });
    view.querySelector("#lvl").addEventListener("change", (e) => { level = e.target.value; draw(); });
    draw();
  },
};
