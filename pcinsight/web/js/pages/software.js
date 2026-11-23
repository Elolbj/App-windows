import { bars, colors } from "../charts.js";
import {
  DataTable, GLOSSARY, badge, bindSeg, card, errorBox, fmtBytes, fmtDate, fmtDateTime, fmtNum, help, html, loading, seg, setHTML, summary, tile,
} from "../ui.js";

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

    const tasks = sw.tasks || [];
    const activeTasks = tasks.filter((t) => t.state !== "Disabled");
    setHTML(view, html`
      ${summary([
        { kind: st.startup_enabled >= 15 ? "warning" : st.startup_enabled >= 8 ? "info" : "good", title: `${st.startup_enabled} programme(s) au démarrage`, text: st.startup_enabled >= 8 ? "Chacun ralentit l'ouverture de session : désactivez ceux dont vous n'avez pas besoin tout de suite." : "Démarrage léger." },
        { kind: "info", title: `${activeTasks.length} tâche(s) planifiée(s) tierces actives`, text: "Programmes lancés automatiquement selon un horaire ou un événement (mises à jour, télémétrie…)." },
        { kind: "info", title: `${st.third_party_services || 0} service(s) tiers`, text: "Services installés par des logiciels, hors composants de Windows." },
      ])}
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
      <div class="tabs">${seg([["programs", `Programmes (${st.count})`], ["startup", `Démarrage (${st.startup_total})`], ["tasks", `Tâches planifiées (${tasks.length})`], ["services", `Services (${sw.services.length})`], ["store", `Microsoft Store (${sw.store.length})`]], "programs")}</div>
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
          filters: html`<select aria-label="Filtrer les services"><option value="">Tous</option><option value="third">Services tiers (non Windows)</option><option value="running">En cours</option><option value="stopped">Arrêtés</option><option value="auto-stopped">Automatiques arrêtés</option><option value="disabled">Désactivés</option></select>`,
          columns: [
            { key: "display_name", label: "Nom affiché" },
            { key: "name", label: "Nom", cls: "mono" },
            { key: "status", label: "État", render: (s) => { const [l, k] = STATUS[s.status] || [s.status, ""]; return badge(l, k); } },
            { key: "start_type", label: "Démarrage", render: (s) => START[s.start_type] || s.start_type },
            { key: "third_party", label: "Origine", value: (s) => (s.third_party ? 1 : 0), render: (s) => (s.third_party ? html`<span class="tag">Tiers</span>` : html`<span class="muted">Windows</span>`) },
            { key: "user", label: "Compte", render: (s) => s.user || "—" },
            { key: "binpath", label: "Exécutable", cls: "mono clip", render: (s) => (s.binpath ? html`<span title="${s.binpath}">${s.binpath}</span>` : "—") },
          ],
        });
        tabEl.querySelector("select").addEventListener("change", (e) => {
          const v = e.target.value;
          t.setFilter(!v ? null : v === "third" ? (s) => s.third_party : v === "auto-stopped" ? (s) => s.start_type === "automatic" && s.status === "stopped"
            : v === "disabled" ? (s) => s.start_type === "disabled" : (s) => s.status === v);
        });
        return t;
      },
      tasks: () => {
        setHTML(tabEl, html`<p class="small text-2" style="margin-top:0">Tâches hors du dossier \\Microsoft\\ du Planificateur. ${help(GLOSSARY.persistence)} Une tâche exécutée avec les droits les plus élevés depuis un dossier utilisateur (AppData, Temp) est signalée dans le diagnostic.</p><div id="t-tasks"></div>`);
        return new DataTable(tabEl.querySelector("#t-tasks"), {
          rows: tasks, sortKey: "name", empty: "Aucune tâche planifiée tierce.",
          columns: [
            { key: "name", label: "Tâche", render: (t) => html`${t.name}<div class="small muted">${t.path}</div>` },
            { key: "state", label: "État", render: (t) => (t.state === "Disabled" ? badge("Désactivée", "") : t.state === "Running" ? badge("En cours", "info") : badge("Active", "good")) },
            { key: "triggers", label: "Déclencheur", value: (t) => t.triggers.join(", "), render: (t) => t.triggers.join(", ") || "—" },
            { key: "runAs", label: "Compte", render: (t) => html`${t.runAs || "—"}${t.elevated ? html` <span class="tag">droits élevés</span>` : ""}` },
            { key: "lastRun", label: "Dernière exécution", cls: "nowrap", render: (t) => (t.lastRun ? fmtDateTime(t.lastRun) : "jamais") },
            { key: "actions", label: "Action", cls: "mono clip", value: (t) => t.actions.join(" ; "), render: (t) => html`<span title="${t.actions.join(" ; ")}">${t.actions.join(" ; ") || "—"}</span>` },
          ],
        });
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
