import { colors, legend, timeLine } from "../charts.js";
import {
  card, errorBox, fmtAgo, fmtBytes, fmtDate, fmtDuration, fmtMHz, fmtNum, fmtPct, fmtRate, fmtTemp, html, icon, kv,
  meter, raw, setHTML, skeleton, statusChip, tile,
} from "../ui.js";
import { findingList, scoreHero } from "./analysis.js";

export default {
  title: "Tableau de bord",
  subtitle: "L'essentiel de votre PC en un coup d'œil",

  async render(view, ctx) {
    const c = colors();
    setHTML(view, html`
      <div class="grid cols-3">
        ${card("Santé du PC", html`<div id="score">${skeleton(4)}</div>`, { cls: "span-2", ico: "report", sub: "Note calculée à partir de toutes les sections", tools: html`<a href="#/analysis">Détail</a>` })}
        ${card("À faire en priorité", html`<div id="todo">${skeleton(4)}</div>`, { ico: "alert" })}
      </div>
      <div class="grid cols-6">
        ${tile("Processeur", "—", { ico: "cpu", id: "t-cpu", meter: meter(0) })}
        ${tile("Mémoire vive", "—", { ico: "memory", id: "t-ram", meter: meter(0) })}
        ${tile("Carte graphique", "—", { ico: "gpu", id: "t-gpu", meter: meter(0) })}
        ${tile("Disque système", "—", { ico: "disk", id: "t-disk", meter: meter(0) })}
        ${tile("Réseau", "—", { ico: "network", id: "t-net" })}
        ${tile("Allumé depuis", "—", { ico: "clock", id: "t-uptime" })}
      </div>
      <div class="grid cols-3">
        ${card("Activité en direct", html`<div class="legend">${raw(legend([["Processeur", c.series[0]], ["Mémoire", c.series[1]], ["Carte graphique", c.series[2]]], "line"))}</div><div class="chart"><canvas id="live"></canvas></div>`, { cls: "span-2", ico: "activity", sub: "5 dernières minutes, en %" })}
        ${card("Ce PC", html`<div id="pc">${skeleton(6)}</div>`, { ico: "cpu" })}
      </div>
      <div class="grid cols-4">
        ${tile("Erreurs (7 jours)", "—", { ico: "alert", id: "t-errors" })}
        ${tile("Mise à jour Windows", "—", { ico: "updates", id: "t-update" })}
        ${tile("Protection", "—", { ico: "shield", id: "t-sec" })}
        ${tile("Programmes au démarrage", "—", { ico: "power", id: "t-startup" })}
      </div>`);

    const setTile = (id, value, hint, pct, opts, status) => {
      const el = view.querySelector(`#${id}`);
      if (!el) return;
      setHTML(el.querySelector('[data-role="value"]'), value);
      if (hint !== undefined) el.querySelector('[data-role="hint"]').textContent = hint;
      const m = el.querySelector(".meter");
      if (m && pct !== undefined && pct !== null) m.outerHTML = String(meter(pct, opts));
      if (status !== undefined) {
        let chip = el.querySelector('[data-role="chip"]');
        if (!chip) { chip = document.createElement("span"); chip.className = "chip"; chip.dataset.role = "chip"; el.prepend(chip); }
        setHTML(chip, status ? statusChip(status) : "");
      }
    };

    // ---------------------------------------------------------------- temps réel
    const chart = ctx.chart(timeLine(view.querySelector("#live"), {
      series: [
        { label: "Processeur", color: c.series[0], data: [], area: true },
        { label: "Mémoire", color: c.series[1], data: [] },
        { label: "Carte graphique", color: c.series[2], data: [] },
      ],
      yMax: 100, yFormat: (v) => `${v} %`, tooltipFormat: (v) => fmtPct(v, 1),
    }));
    let last = 0;
    const tick = async () => {
      let r;
      try { r = await ctx.api.get("live", { since: last }); } catch { return; }
      if (!ctx.alive() || !r.points.length) return;
      last = r.points[r.points.length - 1].t;
      const cut = Date.now() - 5 * 60 * 1000;
      const [cpu, ram, gpu] = chart.data.datasets;
      for (const p of r.points) {
        cpu.data.push({ x: p.t * 1000, y: p.cpu });
        ram.data.push({ x: p.t * 1000, y: p.ram });
        if (p.gpu !== null && p.gpu !== undefined) gpu.data.push({ x: p.t * 1000, y: p.gpu });
      }
      chart.data.datasets.forEach((d) => { while (d.data.length && d.data[0].x < cut) d.data.shift(); });
      chart.options.scales.x.min = cut;
      chart.options.scales.x.max = Date.now();
      chart.update("none");
      const p = r.points[r.points.length - 1];
      const i = r.info;
      const freq = p.cpu_mhz || (i.freq && i.freq.current);
      setTile("t-cpu", fmtPct(p.cpu), [freq ? fmtMHz(freq) : `${i.cpu_logical} threads`, p.cpu_temp ? fmtTemp(p.cpu_temp) : ""].filter(Boolean).join(" · "), p.cpu);
      setTile("t-ram", fmtPct(p.ram), `${fmtBytes(p.ram_used)} sur ${fmtBytes(i.ram_total)}`, p.ram, { warn: 80, crit: 92 });
      setTile("t-gpu", p.gpu === null || p.gpu === undefined ? "—" : fmtPct(p.gpu),
        p.gpu === null || p.gpu === undefined ? "mesure indisponible" : [p.gpu_mem ? `${fmtBytes(p.gpu_mem)} VRAM` : "", p.gpu_temp ? fmtTemp(p.gpu_temp) : ""].filter(Boolean).join(" · ") || "charge du GPU", p.gpu ?? 0);
      setTile("t-net", fmtRate(p.net_down + p.net_up), `↓ ${fmtRate(p.net_down)} · ↑ ${fmtRate(p.net_up)}`);
      setTile("t-uptime", fmtDuration(i.uptime), `${fmtNum(i.process_count)} processus`);
    };
    await tick();
    ctx.every(2000, tick);

    // ---------------------------------------------------------------- sections (chargées en parallèle)
    ctx.api.section("storage").then(({ data }) => {
      const sys = data.partitions.find((p) => p.system) || data.partitions[0];
      if (sys && ctx.alive()) setTile("t-disk", `${fmtBytes(sys.free)} libres`, `${sys.mount} · ${fmtPct(sys.percent)} utilisé`, sys.percent, { warn: 80, crit: 90 });
    }).catch(() => {});

    ctx.api.section("events").then(({ data }) => {
      if (!ctx.alive()) return;
      const week = data.stats.per_day.slice(-7);
      const errs = week.reduce((s, d) => s + d.critical + d.error, 0);
      const crit = week.reduce((s, d) => s + d.critical, 0);
      const inc = (data.stats.incidents || []).filter((x) => Date.now() - new Date(x.time).getTime() < 7 * 86400000).length;
      setTile("t-errors", fmtNum(errs), inc ? `${inc} incident(s) système` : crit ? `dont ${crit} critique(s)` : "aucun incident système", null, null, inc ? "warning" : "good");
    }).catch(() => setTile("t-errors", "—", "indisponible"));

    ctx.api.section("updates").then(({ data }) => {
      if (!ctx.alive()) return;
      const lq = data.stats.last_quality || data.stats.last_hotfix;
      const days = data.stats.days_since_quality ?? data.stats.days_since_hotfix;
      setTile("t-update", lq ? fmtAgo(lq) : "—", lq ? `dernier correctif le ${fmtDate(lq)}` : "historique vide", null, null,
        days === null || days === undefined ? null : days > 60 ? "critical" : days > 40 ? "warning" : "good");
    }).catch(() => setTile("t-update", "—", "indisponible"));

    ctx.api.section("security").then(({ data }) => {
      if (!ctx.alive()) return;
      const av = (data.defender && data.defender.realTime) || data.antivirus.some((a) => a.enabled && !/defender/i.test(a.name || ""));
      const fw = data.firewall.length && data.firewall.every((f) => f.enabled);
      setTile("t-sec", av && fw ? "Active" : "Incomplète", `antivirus ${av ? "actif" : "inactif"} · pare-feu ${fw ? "actif" : "désactivé"}`, null, null, av && fw ? "good" : "critical");
    }).catch(() => setTile("t-sec", "—", "indisponible"));

    ctx.api.section("software").then(({ data }) => {
      if (!ctx.alive()) return;
      const n = data.stats.startup_enabled;
      setTile("t-startup", fmtNum(n), `${data.stats.startup_total - n} désactivé(s) · ${data.tasks ? data.tasks.length : 0} tâche(s) planifiée(s)`, null, null, n >= 15 ? "warning" : "good");
    }).catch(() => setTile("t-startup", "—", "indisponible"));

    Promise.all([
      ctx.api.section("system"), ctx.api.section("hardware").catch(() => null), ctx.api.section("osinfo").catch(() => null),
      ctx.api.section("storage").catch(() => null),
    ]).then(([s, h, o, st]) => {
      if (!ctx.alive()) return;
      const sys = s.data, hw = h && h.data, os = o && o.data;
      const w = sys.windows || {};
      const cpu = hw && hw.cpu[0];
      const gpus = hw ? hw.gpu.filter((g) => !/basic|virtual|remote|mirror|hyper-v/i.test(g.name || "")) : [];
      const boots = os && os.boots ? os.boots.slice(-5) : [];
      setHTML(view.querySelector("#pc"), kv([
        ["Nom", sys.hostname],
        ["Windows", w.product ? html`${w.product} ${w.display_version || ""} ${os && os.activation ? statusChip(os.activation.status === 1 ? "good" : "warning", os.activation.label) : ""}` : sys.platform],
        ["Modèle", hw ? `${hw.system.manufacturer || ""} ${hw.system.model || ""}`.trim() : null],
        ["Processeur", cpu ? cpu.name : sys.processor],
        ["Graphique", gpus.map((g) => g.name).join(", ")],
        ["Mémoire", fmtBytes(hw && hw.memory.total ? hw.memory.total : sys.ram_total, 0)],
        ["Stockage", st ? `${fmtBytes(st.data.total, 0)} (${fmtBytes(st.data.free, 0)} libres)` : null],
        ["Démarrage", boots.length ? `${fmtNum(boots.reduce((a, b) => a + b.seconds, 0) / boots.length, 0)} s en moyenne` : null],
      ]));
    }).catch((e) => setHTML(view.querySelector("#pc"), errorBox(e.message)));

    try {
      const a = await ctx.api.get("analysis", { refresh: ctx.refresh ? "1" : undefined });
      if (!ctx.alive()) return;
      ctx.setAnalysis(a);
      setHTML(view.querySelector("#score"), scoreHero(a, true));
      const todo = a.findings.filter((f) => f.severity === "critical" || f.severity === "warning").slice(0, 4);
      setHTML(view.querySelector("#todo"), todo.length ? findingList(todo, { advice: false, links: true })
        : html`<div class="finding good">${icon("check")}<div><div class="t">Rien d'urgent</div><div class="d">Aucun problème ni point à surveiller. Consultez le diagnostic pour les conseils d'amélioration.</div></div></div>`);
    } catch (e) {
      setHTML(view.querySelector("#score"), errorBox(`Analyse impossible : ${e.message}`));
      setHTML(view.querySelector("#todo"), "");
    }
  },
};
