import { bars, colors, legend } from "../charts.js";
import {
  DataTable, badge, card, errorBox, fmtAgo, fmtBytes, fmtDate, fmtDateTime, fmtNum, fmtPct, html, icon, loading, raw, scriptNotes, setHTML, summary, tile, toast,
} from "../ui.js";

const RESULT_KIND = { 2: "good", 3: "warning", 4: "critical", 5: "warning", 1: "info" };

export default {
  title: "Mises à jour",
  subtitle: "Historique Windows Update, échecs et version de Windows",

  async render(view, ctx) {
    setHTML(view, loading("Lecture de l'historique Windows Update…"));
    let u, sys;
    try {
      [u, sys] = await Promise.all([ctx.api.section("updates", ctx.refresh).then((r) => r.data), ctx.api.section("system").then((r) => r.data)]);
    } catch (e) { setHTML(view, errorBox(e.message)); return; }
    if (!ctx.alive()) return;
    const st = u.stats;
    const w = sys.windows || {};
    const sup = w.support || {};
    const c = colors();

    const daysQ = st.days_since_quality ?? st.days_since_hotfix;
    setHTML(view, html`
      ${summary([
        sup.known ? { kind: sup.supported ? (sup.days_left <= 90 ? "warning" : "good") : "critical", title: sup.supported ? `${w.product} ${w.display_version || ""} est pris en charge` : "Version de Windows plus prise en charge", text: sup.supported ? `Correctifs de sécurité jusqu'au ${fmtDate(sup.end)}.` : `Plus de correctifs depuis le ${fmtDate(sup.end)} : passez à une version récente via Windows Update.` }
          : { kind: "info", title: w.product || "Version de Windows", text: "Date de fin de support non référencée pour cette édition." },
        daysQ !== null && daysQ !== undefined ? { kind: daysQ > 60 ? "critical" : daysQ > 40 ? "warning" : "good", title: daysQ > 40 ? "Mises à jour en retard" : "Windows est à jour", text: `Dernier correctif installé il y a ${daysQ} jour(s). Microsoft publie un correctif de sécurité chaque 2e mardi du mois.` } : null,
        { kind: st.unresolved_failed.length ? "warning" : "good", title: st.unresolved_failed.length ? `${st.unresolved_failed.length} échec(s) à traiter` : "Aucun échec récent non résolu", text: sys.reboot_pending.length ? `Redémarrage en attente (${sys.reboot_pending.join(", ")}).` : "" },
      ])}
      <div class="grid cols-6">
        ${tile("Version de Windows", w.display_version || "—", { ico: "updates", hint: `${w.product || ""} · build ${w.build || "?"}` })}
        ${tile("Fin du support", sup.known ? fmtDate(sup.end) : "—", { hint: sup.known ? (sup.supported ? `dans ${fmtNum(sup.days_left)} jours` : "dépassée : plus de correctifs") : "non déterminée" })}
        ${st.last_quality || !st.last_hotfix
          ? tile("Dernière cumulative", st.last_quality ? fmtAgo(st.last_quality) : "—", { hint: st.last_quality ? fmtDate(st.last_quality) : "aucune dans l'historique" })
          : tile("Dernier correctif", fmtAgo(st.last_hotfix), { hint: `KB installé le ${fmtDate(st.last_hotfix)}` })}
        ${tile("Taux de réussite", fmtPct(st.success_rate, 1), { hint: `${fmtNum(st.failed)} échec(s) sur ${fmtNum(st.total)}` })}
        ${tile("Échecs non résolus", fmtNum(st.unresolved_failed.length), { hint: "30 derniers jours" })}
        ${tile("Redémarrage en attente", sys.reboot_pending.length ? "Oui" : "Non", { hint: sys.reboot_pending.join(", ") || "rien en attente" })}
      </div>
      <div class="grid cols-3">
        ${card("Installations par mois", html`<div class="legend">${raw(legend([["Réussies", c.good], ["Échouées", c.critical]]))}</div><div class="chart"><canvas id="c-month"></canvas></div>`, { cls: "span-2", sub: "12 derniers mois" })}
        ${card("Par catégorie", html`<div class="chart"><canvas id="c-cat"></canvas></div>`, { sub: "Ensemble de l'historique" })}
      </div>
      <div class="grid">${card("Mises à jour disponibles", html`<div id="pending"><p class="text-2 small">La recherche interroge les serveurs Microsoft et peut durer plusieurs minutes. Rien n'est installé.</p>
        <button class="btn primary" id="btn-search" type="button">${icon("search")}Rechercher les mises à jour</button></div>`)}</div>
      ${st.unresolved_failed.length ? html`<div class="grid">${card("Échecs à traiter", html`<div id="t-failed"></div>`, { sub: "Échecs récents sans installation réussie ensuite" })}</div>` : ""}
      <div class="grid">${card("Historique", html`<div id="t-hist"></div>`, { sub: `${fmtNum(u.total_history)} entrée(s) dans l'historique Windows Update` })}</div>
      <div class="grid">${card("Correctifs installés (KB)", html`<div id="t-hot"></div>`, { sub: "Liste de Get-HotFix" })}</div>
      ${scriptNotes(u.errors, ctx.status.admin)}`);

    const months = st.per_month;
    ctx.chart(bars(view.querySelector("#c-month"), {
      labels: months.map((m) => new Date(`${m.month}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" })),
      stacked: true,
      datasets: [
        { label: "Réussies", data: months.map((m) => m.success), color: c.good },
        { label: "Échouées", data: months.map((m) => m.failed), color: c.critical },
      ],
    }));
    ctx.chart(bars(view.querySelector("#c-cat"), {
      labels: st.by_category.map(([k]) => k), datasets: [{ label: "Mises à jour", data: st.by_category.map(([, n]) => n), color: c.series[0] }], horizontal: true,
    }));

    const errCol = { key: "error", label: "Code", value: (h) => h.error.hex || "", render: (h) => (h.error.hex ? html`<span class="mono" title="${h.error.label || ""}">${h.error.hex}</span>${h.error.label ? html`<div class="small muted">${h.error.label}</div>` : ""}` : "—") };
    if (st.unresolved_failed.length) {
      new DataTable(view.querySelector("#t-failed"), {
        rows: st.unresolved_failed, search: false,
        columns: [
          { key: "date", label: "Date", cls: "nowrap", render: (h) => fmtDateTime(h.date) },
          { key: "title", label: "Mise à jour", cls: "wrap" },
          errCol,
        ],
      });
    }
    const histTable = new DataTable(view.querySelector("#t-hist"), {
      rows: u.history, sortKey: "date", sortDir: "desc", pageSize: 40,
      filters: html`<select aria-label="Catégorie"><option value="">Toutes catégories</option>${st.by_category.map(([k]) => html`<option>${k}</option>`)}</select>`,
      columns: [
        { key: "date", label: "Date", cls: "nowrap", render: (h) => fmtDateTime(h.date) },
        { key: "title", label: "Mise à jour", cls: "wrap" },
        { key: "category", label: "Catégorie" },
        { key: "operation_label", label: "Opération" },
        { key: "result", label: "Résultat", render: (h) => badge(h.result_label, RESULT_KIND[h.result] || "") },
        errCol,
      ],
    });
    histTable.el.querySelector("select").addEventListener("change", (e) => {
      const v = e.target.value;
      histTable.setFilter(v ? (h) => h.category === v : null);
    });

    new DataTable(view.querySelector("#t-hot"), {
      rows: u.hotfixes, sortKey: "installedOn", sortDir: "desc", pageSize: 20, search: false,
      columns: [
        { key: "id", label: "KB", cls: "mono" },
        { key: "description", label: "Type" },
        { key: "installedOn", label: "Installé le", render: (h) => fmtDate(h.installedOn) },
      ],
    });

    // recherche des mises à jour en attente (rien n'est installé)
    const searchButton = (label) => html`<button class="btn primary" id="btn-search" type="button">${icon("search")}${label}</button>`;
    const bindSearch = () => {
      const btn = view.querySelector("#btn-search");
      if (!btn) return;
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.classList.add("spin");
        setHTML(btn, html`${icon("refresh")}Recherche en cours…`);
        try {
          const res = await ctx.api.post("updates/pending");
          if (ctx.alive()) renderPending(res);
        } catch (e) {
          toast(`Recherche impossible : ${e.message}`);
          btn.disabled = false;
          btn.classList.remove("spin");
          setHTML(btn, html`${icon("search")}Rechercher les mises à jour`);
        }
      });
    };
    const renderPending = (res) => {
      const box = view.querySelector("#pending");
      if (!box) return;
      const errs = res.errors || [];
      setHTML(box, html`
        <div class="row" style="margin-bottom:10px"><span class="small text-2">Recherche du ${fmtDateTime(res.checked)} : ${res.updates.length ? `${res.updates.length} mise(s) à jour disponible(s).` : "aucune mise à jour en attente."}</span><span class="spacer"></span>${searchButton("Relancer la recherche")}</div>
        ${errs.length ? errorBox(errs.join(" ; ")) : ""}
        <div id="t-pending"></div>`);
      bindSearch();
      if (res.updates.length) {
        new DataTable(box.querySelector("#t-pending"), {
          rows: res.updates, search: false,
          columns: [
            { key: "title", label: "Mise à jour", cls: "wrap" },
            { key: "kb", label: "KB", cls: "mono" },
            { key: "severity", label: "Gravité", render: (p) => (p.severity ? badge(p.severity, p.severity === "Critical" ? "critical" : "warning") : "—") },
            { key: "size", label: "Taille", num: true, render: (p) => fmtBytes(p.size) },
            { key: "downloaded", label: "Téléchargée", render: (p) => (p.downloaded ? "Oui" : "Non") },
          ],
        });
      }
    };
    bindSearch();
    const existing = await ctx.api.get("updates/pending").catch(() => null);
    if (existing && existing.result && ctx.alive()) renderPending(existing.result);
  },
};
