import { bars, colors } from "../charts.js";
import { DataTable, badge, bindSeg, card, errorBox, fmtBytes, fmtDate, fmtNum, html, loading, seg, setHTML, tile } from "../ui.js";

const STATUS = { running: ["En cours", "good"], stopped: ["Arrêté", ""], paused: ["En pause", "warning"], start_pending: ["Démarrage", "info"], stop_pending: ["Arrêt", "info"] };
const START = { automatic: "Automatique", manual: "Manuel", disabled: "Désactivé" };

export default {
  title: "Logiciels",
  subtitle: "Programmes installés, démarrage automatique et services",

  async render(view, ctx) {
    setHTML(view, loading("Lecture du registre et des services…"));
    let sw;
    try { sw = (await ctx.api.section("software", ctx.refresh)).data; } catch (e) { setHTML(view, errorBox(e.message)); return; }
    if (!ctx.alive()) return;
    const st = sw.stats;
    const running = st.services_status.find(([k]) => k === "running");
    const c = colors();

    // 24 derniers mois, y compris ceux sans installation
    const months = [];
    const d = new Date();
    d.setDate(1);
    for (let i = 23; i >= 0; i--) {
      const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
      months.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`);
    }
    const perMonth = Object.fromEntries(st.installs_by_month);

    setHTML(view, html`
      <div class="grid cols-4">
        ${tile("Programmes installés", fmtNum(st.count), { ico: "package", hint: `${fmtNum(sw.store.length)} application(s) du Store en plus` })}
        ${tile("Taille déclarée", fmtBytes(st.total_size), { hint: `selon ${st.with_size} programme(s) qui l'indiquent` })}
        ${tile("Au démarrage", fmtNum(st.startup_enabled), { hint: `${st.startup_total - st.startup_enabled} désactivé(s)` })}
        ${tile("Services actifs", fmtNum(running ? running[1] : 0), { hint: `sur ${fmtNum(sw.services.length)} services` })}
      </div>
      <div class="grid cols-3">
        ${card("Éditeurs les plus présents", html`<div class="chart tall"><canvas id="c-pub"></canvas></div>`, { sub: "Nombre de programmes" })}
        ${card("Programmes les plus volumineux", html`<div class="chart tall"><canvas id="c-size"></canvas></div>`, { sub: "Taille déclarée à l'installation" })}
        ${card("Installations par mois", html`<div class="chart tall"><canvas id="c-month"></canvas></div>`, { sub: "24 derniers mois (date connue uniquement)" })}
      </div>
      <div class="tabs">${seg([["programs", `Programmes (${st.count})`], ["startup", `Démarrage (${st.startup_total})`], ["services", `Services (${sw.services.length})`], ["store", `Microsoft Store (${sw.store.length})`]], "programs")}</div>
      <div class="card" id="tab"></div>`);

    ctx.chart(bars(view.querySelector("#c-pub"), {
      labels: st.top_publishers.map(([p]) => p), datasets: [{ label: "Programmes", data: st.top_publishers.map(([, n]) => n), color: c.series[0] }], horizontal: true,
    }));
    ctx.chart(bars(view.querySelector("#c-size"), {
      labels: st.largest.map((p) => p.name), datasets: [{ label: "Taille", data: st.largest.map((p) => p.size), color: c.series[2] }], horizontal: true, format: (v) => fmtBytes(v, 0),
    }));
    ctx.chart(bars(view.querySelector("#c-month"), {
      labels: months.map((m) => new Date(`${m}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" })),
      datasets: [{ label: "Installations", data: months.map((m) => perMonth[m] || 0), color: c.series[6] }], maxTicks: 8,
    }));

    const tabEl = view.querySelector("#tab");
    const tabs = {
      programs: () => new DataTable(tabEl, {
        rows: sw.programs, sortKey: "name", pageSize: 60,
        columns: [
          { key: "name", label: "Nom" },
          { key: "version", label: "Version", cls: "nowrap" },
          { key: "publisher", label: "Éditeur" },
          { key: "install_date", label: "Installé le", cls: "nowrap", render: (p) => (p.install_date ? fmtDate(p.install_date) : "—") },
          { key: "size", label: "Taille", num: true, render: (p) => fmtBytes(p.size) },
          { key: "arch", label: "Type", render: (p) => p.arch || p.scope },
        ],
      }),
      startup: () => new DataTable(tabEl, {
        rows: sw.startup, sortKey: "name",
        columns: [
          { key: "name", label: "Nom" },
          { key: "enabled", label: "État", value: (s) => (s.enabled ? 1 : 0), render: (s) => (s.enabled ? badge("Activé", "good") : badge("Désactivé", "")) },
          { key: "location", label: "Emplacement", cls: "nowrap" },
          { key: "command", label: "Commande", cls: "mono clip", render: (s) => html`<span title="${s.command}">${s.command}</span>` },
        ],
      }),
      services: () => {
        const t = new DataTable(tabEl, {
          rows: sw.services, sortKey: "display_name", pageSize: 80,
          filters: html`<select aria-label="Filtrer les services"><option value="">Tous</option><option value="running">En cours</option><option value="stopped">Arrêtés</option><option value="auto-stopped">Automatiques arrêtés</option><option value="disabled">Désactivés</option></select>`,
          columns: [
            { key: "display_name", label: "Nom affiché" },
            { key: "name", label: "Nom", cls: "mono" },
            { key: "status", label: "État", render: (s) => { const [l, k] = STATUS[s.status] || [s.status, ""]; return badge(l, k); } },
            { key: "start_type", label: "Démarrage", render: (s) => START[s.start_type] || s.start_type },
            { key: "user", label: "Compte", render: (s) => s.user || "—" },
          ],
        });
        tabEl.querySelector("select").addEventListener("change", (e) => {
          const v = e.target.value;
          t.setFilter(!v ? null : v === "auto-stopped" ? (s) => s.start_type === "automatic" && s.status === "stopped"
            : v === "disabled" ? (s) => s.start_type === "disabled" : (s) => s.status === v);
        });
        return t;
      },
      store: () => new DataTable(tabEl, {
        rows: sw.store, sortKey: "name", empty: "Aucune application du Store trouvée.",
        columns: [
          { key: "name", label: "Paquet" },
          { key: "version", label: "Version" },
          { key: "publisher", label: "Éditeur (certificat)", cls: "clip" },
        ],
      }),
    };
    bindSeg(view, ".tabs .seg", (v) => tabs[v]());
    tabs.programs();
  },
};
