import { bars, colors, legend, timeLine } from "../charts.js";
import {
  DataTable, GLOSSARY, badge, card, errorBox, fmtBytes, fmtMHz, fmtNum, fmtPct, fmtTemp, html, icon, level,
  loading, raw, setHTML, summary, tile, toast,
} from "../ui.js";

const TYPE_ORDER = ["Temperature", "Load", "Clock", "Power", "Fan", "Control", "Voltage", "Current", "Data", "SmallData", "Throughput", "Level"];
const TYPE_LABELS = {
  Temperature: "Températures", Load: "Charge", Clock: "Fréquences", Power: "Puissance", Fan: "Ventilateurs",
  Control: "Pilotage des ventilateurs", Voltage: "Tensions", Current: "Intensités", Data: "Données", SmallData: "Mémoire",
  Throughput: "Débit", Level: "Niveau", Factor: "Facteur", Frequency: "Fréquence", Energy: "Énergie",
};
const KIND_ICON = { cpu: "cpu", gpu: "gpu", board: "settings", memory: "memory", storage: "disk", network: "network", battery: "battery", cooler: "fan" };

function fmtSensor(v, unit) {
  if (v === null || v === undefined) return "—";
  if (unit === "o/s") return `${fmtBytes(v)}/s`;
  const digits = unit === "V" ? 3 : unit === "°C" || unit === "W" || unit === "%" ? 1 : 0;
  return `${fmtNum(v, digits)}${unit ? ` ${unit}` : ""}`;
}

const kv = (key, data) => (data.key[key] ? data.key[key] : null);

export default {
  title: "Capteurs",
  subtitle: "Températures, charge du GPU, puissance et ventilateurs",

  async render(view, ctx) {
    setHTML(view, loading("Lecture des capteurs…"));
    let data;
    try { data = await ctx.api.get("sensors"); } catch (e) { setHTML(view, errorBox(e.message)); return; }
    if (!ctx.alive()) return;
    const c = colors();
    const lhm = data.sources.lhm || {};

    const sourceRow = (ok, title, text) => html`<div class="finding ${ok ? "good" : "info"}">${icon(ok ? "check" : "info")}<div><div class="t">${title}</div><div class="d">${text}</div></div></div>`;

    setHTML(view, html`
      <div id="sum"></div>
      <div class="grid cols-6" id="tiles"></div>
      <div class="grid cols-3">
        ${card("Températures en direct", html`<div class="legend">${raw(legend([["Processeur", c.series[1]], ["Carte graphique", c.series[0]]], "line"))}</div><div class="chart"><canvas id="c-temp"></canvas></div>`,
          { cls: "span-2", ico: "thermo", sub: "Dernières minutes, en °C" })}
        ${card("Sources des mesures", html`<div class="findings">
          ${sourceRow(data.sources.counters.ok, "Compteurs de performance Windows", data.sources.counters.ok ? "Charge GPU, fréquence réelle du CPU, activité des disques. Aucun logiciel requis." : "Indisponibles sur ce système.")}
          ${sourceRow(data.sources.nvidia.ok, "NVIDIA (nvidia-smi)", data.sources.nvidia.ok ? "Température, puissance et ventilateur de la carte NVIDIA." : "Aucune carte NVIDIA détectée (outil fourni avec le pilote NVIDIA).")}
          ${sourceRow(lhm.ok, "LibreHardwareMonitor", lhm.ok ? `Connecté (version ${lhm.version || "?"}, port ${lhm.port}) : tous les capteurs de la carte mère, du CPU et des disques.` : lhm.disabled ? "Désactivé dans les paramètres." : "Non détecté : températures CPU, ventilateurs et tensions indisponibles. Voir ci-dessous pour l'activer.")}
        </div>`, { ico: "link" })}
      </div>
      <div id="setup"></div>
      <div id="nvidia"></div>
      <div id="gpu-engines"></div>
      <div id="lhm"></div>
      <div id="acpi"></div>`);

    // ------------------------------------------------------------------ assistant LibreHardwareMonitor
    if (!lhm.ok) {
      const setup = view.querySelector("#setup");
      setHTML(setup, html`<div class="grid">${card("Activer les capteurs avancés avec LibreHardwareMonitor", html`
        <p class="text-2">Windows ne donne pas accès aux températures du processeur ni aux ventilateurs sans pilote spécialisé. LibreHardwareMonitor (logiciel libre, licence MPL 2.0) les lit ; PC Insight récupère ensuite ses mesures, sans rien installer lui-même dans le noyau.</p>
        <ol class="steps">
          <li>Installez-le : bouton ci-dessous (winget) ou téléchargement sur GitHub.
            <div class="code-line"><code>${data.winget}</code></div>
            <div class="row"><button class="btn primary" id="btn-install" type="button">${icon("download")}Installer avec winget</button>
            <button class="btn" id="btn-gh" type="button">${icon("external")}Page de téléchargement</button></div></li>
          <li>Installez le pilote <b>PawnIO</b>, indispensable depuis la version 0.9.5 de LibreHardwareMonitor (sans lui, les valeurs du processeur restent à zéro).
            <div class="row" style="margin-top:6px"><button class="btn" id="btn-pawnio" type="button">${icon("external")}Télécharger PawnIO (GitHub)</button></div></li>
          <li>Lancez <b>LibreHardwareMonitor en administrateur</b>.</li>
          <li>Menu <b>Options → Remote Web Server → Run</b> (port ${lhm.port || 8085} par défaut). Si Windows demande d'autoriser l'accès réseau, choisissez <b>Annuler / réseaux privés uniquement</b> : PC Insight lit les données localement.</li>
          <li>Facultatif : <b>Options → Start Minimized</b> et <b>Run On Windows Startup</b> pour l'avoir en permanence.</li>
        </ol>
        <div class="warn-box"><b>À savoir avant d'installer :</b>
          <ul class="steps">
            <li>Le pilote PawnIO s'exécute dans le noyau Windows (comme tout outil de monitoring). Il remplace l'ancien WinRing0, signalé comme vulnérable (CVE-2020-14979).</li>
            <li>Certains anti-triche de jeux en ligne refusent la présence de PawnIO : désinstallez-le si un jeu vous le signale.</li>
            <li>Le serveur web de LibreHardwareMonitor n'a pas de mot de passe par défaut et écoute sur toutes les interfaces : ne l'autorisez pas dans le pare-feu pour les réseaux publics, ou activez l'authentification dans ses options.</li>
          </ul></div>`, { ico: "thermo" })}</div>`);
      setup.querySelector("#btn-install").addEventListener("click", async () => {
        try { await ctx.api.post("tools/install-lhm"); toast("Installation lancée dans une console (winget)."); } catch (e) { toast(e.message); }
      });
      setup.querySelector("#btn-gh").addEventListener("click", () => ctx.api.post("tools/open-link", { target: "lhm" }).catch((e) => toast(e.message)));
      setup.querySelector("#btn-pawnio").addEventListener("click", () => ctx.api.post("tools/open-link", { target: "pawnio" }).catch((e) => toast(e.message)));
    }

    // ------------------------------------------------------------------ graphique températures
    const chart = ctx.chart(timeLine(view.querySelector("#c-temp"), {
      series: [{ label: "Processeur", color: c.series[1], data: [] }, { label: "Carte graphique", color: c.series[0], data: [] }],
      yFormat: (v) => `${v} °C`, tooltipFormat: (v) => fmtTemp(v),
    }));
    let last = 0;
    const lhmTables = new Map();

    const draw = (d) => {
      const T = (k) => kv(k, d);
      const cpuT = T("cpu_temp"), gpuT = T("gpu_temp");
      const cpuLvl = cpuT && !/ACPI/.test(cpuT.source) ? level(cpuT.value, 80, 90) : null;
      const gpuLvl = gpuT ? level(gpuT.value, 80, 88) : null;
      setHTML(view.querySelector("#sum"), summary([
        cpuT ? { kind: cpuLvl || "info", title: `Processeur : ${fmtTemp(cpuT.value)}`, text: /ACPI/.test(cpuT.source) ? "Valeur approximative (zone thermique de la carte mère)." : cpuLvl === "good" ? "Température normale." : cpuLvl === "warning" ? "Chaud : normal en pleine charge, suspect au repos." : "Très chaud : le processeur va ralentir pour se protéger." }
          : { kind: "info", title: "Température du processeur inconnue", text: "Installez LibreHardwareMonitor pour la mesurer." },
        gpuT ? { kind: gpuLvl, title: `Carte graphique : ${fmtTemp(gpuT.value)}`, text: gpuLvl === "good" ? "Température normale." : "Chaude : vérifiez la ventilation." } : null,
        T("gpu_load") ? { kind: "info", title: `GPU utilisé à ${fmtPct(T("gpu_load").value)}`, text: "Charge du moteur le plus occupé." } : null,
      ]));
      const t = (label, k, fmt, ico, tip) => {
        const v = T(k);
        return tile(label, v ? fmt(v.value) : "—", { ico, hint: v ? v.source : "non disponible", tip });
      };
      setHTML(view.querySelector("#tiles"), html`
        ${t("Température CPU", "cpu_temp", fmtTemp, "thermo")}
        ${t("Température GPU", "gpu_temp", fmtTemp, "thermo")}
        ${t("Charge GPU", "gpu_load", (v) => fmtPct(v), "gpu", GLOSSARY.gpuLoad)}
        ${t("Puissance CPU", "cpu_power", (v) => `${fmtNum(v, 0)} W`, "bolt")}
        ${t("Puissance GPU", "gpu_power", (v) => `${fmtNum(v, 0)} W`, "bolt")}
        ${t("Ventilateur le plus rapide", "fan_max", (v) => `${fmtNum(v)} tr/min`, "fan")}`);

      for (const h of d.history || []) {
        if (h.t <= last) continue;
        if (h.cpu_temp !== undefined) chart.data.datasets[0].data.push({ x: h.t * 1000, y: h.cpu_temp });
        if (h.gpu_temp !== undefined) chart.data.datasets[1].data.push({ x: h.t * 1000, y: h.gpu_temp });
        last = h.t;
      }
      const cut = Date.now() - 10 * 60 * 1000;
      chart.data.datasets.forEach((ds) => { while (ds.data.length && ds.data[0].x < cut) ds.data.shift(); });
      chart.options.scales.x.min = cut;
      chart.options.scales.x.max = Date.now();
      chart.update("none");

      // NVIDIA
      const nv = d.nvidia || [];
      setHTML(view.querySelector("#nvidia"), nv.length ? html`<div class="grid cols-2">${nv.map((g) => card(g.name, html`<div class="sensor-grid">
        <div><div class="small text-2">Température</div><div class="big-num">${fmtNum(g.temp)}<small>°C</small></div></div>
        <div><div class="small text-2">Charge</div><div class="big-num">${fmtNum(g.load)}<small>%</small></div></div>
        <div><div class="small text-2">Puissance</div><div class="big-num">${fmtNum(g.power, 0)}<small>W / ${fmtNum(g.power_limit, 0)} W</small></div></div>
        <div><div class="small text-2">Ventilateur</div><div class="big-num">${g.fan === null ? "—" : fmtNum(g.fan)}<small>${g.fan === null ? "" : "%"}</small></div></div>
        <div><div class="small text-2">Mémoire vidéo</div><div class="big-num">${fmtBytes(g.mem_used, 1)}<small>/ ${fmtBytes(g.mem_total, 0)}</small></div></div>
        <div><div class="small text-2">Fréquences</div><div class="big-num">${fmtMHz(g.clock)}<small>mém. ${fmtMHz(g.mem_clock)}</small></div></div>
      </div><p class="notes">Source : nvidia-smi · pilote ${g.driver} · état ${g.pstate} (P0 = performances max, P8 = repos)</p>`, { ico: "gpu" }))}</div>` : "");

      // LibreHardwareMonitor : un tableau par matériel
      const box = view.querySelector("#lhm");
      if (d.lhm && d.lhm.sensors.length) {
        const groups = d.lhm.hardware.map((hw) => ({ hw, sensors: d.lhm.sensors.filter((s) => s.hardware === hw.name) })).filter((g) => g.sensors.length);
        if (!box.dataset.mounted || box.dataset.count !== String(groups.length)) {
          box.dataset.mounted = "1";
          box.dataset.count = String(groups.length);
          lhmTables.clear();
          setHTML(box, html`<div class="section-title">Tous les capteurs (LibreHardwareMonitor)</div><div class="grid cols-2">${groups.map((g, i) =>
            card(g.hw.name, html`<div id="lhm-${i}"></div>`, { ico: KIND_ICON[g.hw.kind] || "settings" }))}</div>`);
          groups.forEach((g, i) => {
            lhmTables.set(g.hw.name, new DataTable(box.querySelector(`#lhm-${i}`), {
              rows: [], search: false, pageSize: 200,
              columns: [
                { key: "type", label: "Type", value: (s) => TYPE_ORDER.indexOf(s.type) === -1 ? 99 : TYPE_ORDER.indexOf(s.type), render: (s) => TYPE_LABELS[s.type] || s.type },
                { key: "name", label: "Capteur" },
                { key: "value", label: "Valeur", num: true, render: (s) => html`<b>${fmtSensor(s.value, s.unit)}</b>` },
                { key: "min", label: "Min", num: true, render: (s) => fmtSensor(s.min, s.unit) },
                { key: "max", label: "Max", num: true, render: (s) => fmtSensor(s.max, s.unit) },
              ],
              sortKey: "type",
            }));
          });
        }
        groups.forEach((g) => { const tbl = lhmTables.get(g.hw.name); if (tbl) tbl.setRows(g.sensors); });
      } else {
        setHTML(box, "");
      }

      // zones ACPI
      const zones = d.thermal || [];
      setHTML(view.querySelector("#acpi"), zones.length ? html`<div class="grid">${card("Zones thermiques ACPI", html`${zones.map((z) => html`<div class="volume"><div class="top"><span class="mono">${z.name}</span><b>${fmtTemp(z.temp)}</b></div></div>`)}`, { tip: GLOSSARY.acpi, ico: "thermo", sub: "Capteurs exposés directement par Windows (approximatifs)" })}</div>` : "");
    };

    // moteurs GPU (compteurs Windows) : graphiques créés une fois puis mis à jour
    let engineCharts = [];
    const engines = async () => {
      let r;
      try { r = await ctx.api.get("counters"); } catch { return; }
      if (!ctx.alive()) return;
      const gpus = (r.data && r.data.gpus) || [];
      const box = view.querySelector("#gpu-engines");
      if (engineCharts.length !== gpus.length) {
        engineCharts.forEach((ch) => ch.destroy());
        engineCharts = [];
        setHTML(box, gpus.length ? html`<div class="grid cols-${Math.min(gpus.length, 2)}">${gpus.map((g, i) => card(`Carte graphique ${i + 1} — détail des moteurs`, html`
          <p class="small text-2" id="eng-mem-${i}"></p>
          <div class="chart short"><canvas id="eng-${i}"></canvas></div>`, { ico: "gpu", tip: GLOSSARY.gpuLoad, sub: "Compteurs de performance Windows" }))}</div>` : "");
        engineCharts = gpus.map((g, i) => ctx.chart(bars(box.querySelector(`#eng-${i}`), {
          labels: [], datasets: [{ label: "Utilisation", data: [], color: c.series[0] }],
          horizontal: true, max: 100, format: (v) => fmtPct(v, 0),
        })));
      }
      gpus.forEach((g, i) => {
        const entries = Object.entries(g.engines);
        engineCharts[i].data.labels = entries.map(([k]) => k);
        engineCharts[i].data.datasets[0].data = entries.map(([, v]) => v);
        engineCharts[i].update("none");
        const mem = box.querySelector(`#eng-mem-${i}`);
        if (mem) setHTML(mem, html`Mémoire dédiée utilisée : <b>${fmtBytes(g.dedicated)}</b> · partagée : ${fmtBytes(g.shared)}`);
      });
    };

    draw(data);
    engines();
    ctx.every(3000, async () => {
      try { const d = await ctx.api.get("sensors", { since: last }); if (ctx.alive()) draw(d); } catch { /* ignoré */ }
    });
    ctx.every(6000, engines);
  },
};
