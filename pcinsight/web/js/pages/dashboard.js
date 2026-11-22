import { colors, legend, timeLine } from "../charts.js";
import { card, errorBox, fmtAgo, fmtBytes, fmtDate, fmtDuration, fmtNum, fmtPct, html, icon, kv, meter, raw, setHTML, skeleton, tile } from "../ui.js";
import { findingList, scoreHero } from "./analysis.js";

export default {
  title: "Tableau de bord",
  subtitle: "Vue d'ensemble de l'état du PC",

  async render(view, ctx) {
    const c = colors();
    setHTML(view, html`
      <div class="grid cols-3">
        ${card("Score de santé", html`<div id="score">${skeleton(4)}</div>`, { cls: "span-2", sub: "Calculé à partir de toutes les sections" })}
        ${card("Ce PC", html`<div id="pc">${skeleton(5)}</div>`)}
      </div>
      <div class="grid cols-6" id="tiles">
        ${tile("Processeur", "—", { ico: "cpu", id: "t-cpu", meter: meter(0) })}
        ${tile("Mémoire vive", "—", { ico: "memory", id: "t-ram", meter: meter(0) })}
        ${tile("Disque système", "—", { ico: "disk", id: "t-disk", meter: meter(0) })}
        ${tile("Allumé depuis", "—", { ico: "clock", id: "t-uptime" })}
        ${tile("Erreurs (7 jours)", "—", { ico: "alert", id: "t-errors" })}
        ${tile("Mise à jour Windows", "—", { ico: "updates", id: "t-update" })}
      </div>
      <div class="grid cols-3">
        ${card("Activité en direct", html`<div class="legend">${raw(legend([["Processeur", c.series[0]], ["Mémoire", c.series[1]]], "line"))}</div><div class="chart"><canvas id="live"></canvas></div>`, { cls: "span-2", sub: "5 dernières minutes, en %" })}
        ${card("Points à surveiller", html`<div id="watch">${skeleton(5)}</div>`, { tools: html`<a href="#/analysis">Tout voir</a>` })}
      </div>`);

    // ---------------------------------------------------------------- temps réel
    const chart = ctx.chart(timeLine(view.querySelector("#live"), {
      series: [
        { label: "Processeur", color: c.series[0], data: [], area: true },
        { label: "Mémoire", color: c.series[1], data: [] },
      ],
      yMax: 100, yFormat: (v) => `${v} %`, tooltipFormat: (v) => fmtPct(v, 1),
    }));
    let last = 0;
    const setTile = (id, value, hint, pct, opts) => {
      const el = view.querySelector(`#${id}`);
      if (!el) return;
      setHTML(el.querySelector('[data-role="value"]'), value);
      if (hint !== undefined) el.querySelector('[data-role="hint"]').textContent = hint;
      const m = el.querySelector(".meter");
      if (m && pct !== undefined) m.outerHTML = String(meter(pct, opts));
    };
    const tick = async () => {
      try {
        const r = await ctx.api.get("live", { since: last });
        if (!ctx.alive() || !r.points.length) return;
        last = r.points[r.points.length - 1].t;
        const cut = Date.now() - 5 * 60 * 1000;
        const [cpu, ram] = chart.data.datasets;
        for (const p of r.points) {
          cpu.data.push({ x: p.t * 1000, y: p.cpu });
          ram.data.push({ x: p.t * 1000, y: p.ram });
        }
        for (const d of chart.data.datasets) while (d.data.length && d.data[0].x < cut) d.data.shift();
        chart.options.scales.x.min = cut;
        chart.options.scales.x.max = Date.now();
        chart.update("none");
        const p = r.points[r.points.length - 1];
        const i = r.info;
        setTile("t-cpu", fmtPct(p.cpu), `${i.cpu_logical} threads${i.freq && i.freq.current ? ` · ${fmtNum(i.freq.current / 1000, 2)} GHz` : ""}`, p.cpu);
        setTile("t-ram", fmtPct(p.ram), `${fmtBytes(p.ram_used)} sur ${fmtBytes(i.ram_total)}`, p.ram, { warn: 80, crit: 92 });
        setTile("t-uptime", fmtDuration(i.uptime), `${fmtNum(i.process_count)} processus`);
      } catch { /* moteur occupé : on réessaie au prochain tour */ }
    };
    await tick();
    ctx.every(2000, tick);

    // ---------------------------------------------------------------- sections
    ctx.api.section("storage").then(({ data }) => {
      const sys = data.partitions.find((p) => p.system) || data.partitions[0];
      if (sys && ctx.alive()) setTile("t-disk", `${fmtBytes(sys.free)} libres`, `${sys.mount} · ${fmtPct(sys.percent)} utilisé`, sys.percent, { warn: 80, crit: 90 });
    }).catch(() => {});

    ctx.api.section("events").then(({ data }) => {
      if (!ctx.alive()) return;
      const week = data.stats.per_day.slice(-7);
      const errs = week.reduce((s, d) => s + d.critical + d.error, 0);
      const crit = week.reduce((s, d) => s + d.critical, 0);
      setTile("t-errors", fmtNum(errs), crit ? `dont ${crit} critique(s)` : `${fmtNum(week.reduce((s, d) => s + d.warning, 0))} avertissements`);
    }).catch(() => setTile("t-errors", "—", "indisponible"));

    ctx.api.section("updates").then(({ data }) => {
      if (!ctx.alive()) return;
      const lq = data.stats.last_quality;
      const hf = data.stats.last_hotfix;
      if (lq) setTile("t-update", fmtAgo(lq), `Cumulative du ${fmtDate(lq)}`);
      else if (hf) setTile("t-update", fmtAgo(hf), `Dernier correctif le ${fmtDate(hf)}`);
      else setTile("t-update", "—", "Aucune mise à jour cumulative");
    }).catch(() => setTile("t-update", "—", "indisponible"));

    Promise.all([ctx.api.section("system"), ctx.api.section("hardware").catch(() => null)]).then(([s, h]) => {
      if (!ctx.alive()) return;
      const sys = s.data, hw = h && h.data;
      const w = sys.windows || {};
      const cpu = hw && hw.cpu[0];
      const gpus = hw ? hw.gpu.filter((g) => !/basic|virtual|remote|mirror/i.test(g.name || "")) : [];
      setHTML(view.querySelector("#pc"), kv([
        ["Nom", sys.hostname],
        ["Windows", w.product ? `${w.product} ${w.display_version || ""}` : sys.platform],
        ["Modèle", hw ? `${hw.system.manufacturer || ""} ${hw.system.model || ""}`.trim() : null],
        ["Processeur", cpu ? cpu.name : sys.processor],
        ["Graphique", gpus.map((g) => g.name).join(", ")],
        ["Mémoire", fmtBytes(hw && hw.memory.total ? hw.memory.total : sys.ram_total, 0)],
        ["Démarré le", fmtDate(sys.boot_time)],
      ]));
    }).catch((e) => setHTML(view.querySelector("#pc"), errorBox(e.message)));

    try {
      const a = await ctx.api.get("analysis", { refresh: ctx.refresh ? "1" : undefined });
      if (!ctx.alive()) return;
      setHTML(view.querySelector("#score"), scoreHero(a));
      const watch = a.findings.filter((f) => f.severity === "critical" || f.severity === "warning").slice(0, 6);
      setHTML(view.querySelector("#watch"), watch.length ? findingList(watch, false)
        : html`<div class="finding good">${icon("check")}<div><div class="t">Rien d'alarmant</div><div class="d">Aucun point critique ou à surveiller.</div></div></div>`);
      const n = a.counts.critical + a.counts.warning;
      ctx.setNavCount("analysis", n, a.counts.critical > 0);
    } catch (e) {
      setHTML(view.querySelector("#score"), errorBox(`Analyse impossible : ${e.message}`));
    }
  },
};
