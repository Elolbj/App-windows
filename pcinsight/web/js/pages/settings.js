import { badge, card, errorBox, fmtBytes, html, icon, kv, loading, setHTML, toast } from "../ui.js";

export default {
  title: "Paramètres",
  subtitle: "Capteurs avancés, données de l'application et informations",

  async render(view, ctx) {
    setHTML(view, loading());
    let s, sensors;
    try {
      [s, sensors] = await Promise.all([ctx.api.get("settings"), ctx.api.get("sensors").catch(() => null)]);
    } catch (e) { setHTML(view, errorBox(e.message)); return; }
    if (!ctx.alive()) return;
    const set = s.settings;
    const lhm = (sensors && sensors.sources.lhm) || {};
    const st = ctx.status;

    setHTML(view, html`
      <div class="grid cols-2">
        ${card("LibreHardwareMonitor (capteurs avancés)", html`
          <p class="text-2 small">PC Insight lit les mesures de LibreHardwareMonitor via son serveur web local (adresse 127.0.0.1 uniquement).</p>
          <div class="form-row"><label class="switch"><input type="checkbox" id="lhm-on" ${set.lhm_enabled ? "checked" : ""}>Lire LibreHardwareMonitor s'il est lancé</label></div>
          <div class="form-row"><label for="lhm-port">Port du serveur web</label><input type="number" id="lhm-port" min="1024" max="65535" value="${set.lhm_port}">
            <button class="btn primary" id="save" type="button">Enregistrer et tester</button></div>
          <div id="lhm-state" style="margin-top:8px">${lhm.ok ? badge(`Connecté — version ${lhm.version || "?"}`, "good") : badge(lhm.disabled ? "Désactivé" : "Non connecté", lhm.disabled ? "" : "warning")}</div>
          <p class="notes">Mode d'emploi complet et installation : page <a href="#/sensors">Capteurs</a>.</p>`, { ico: "thermo" })}
        ${card("Données de l'application", html`${kv([
          ["Dossier", html`<span class="mono">${s.data_dir}</span>`],
          ["Historique des performances", `${fmtBytes(s.history_size)} (30 jours glissants)`],
          ["Rapports exportés", "Documents\\PC Insight"],
        ])}
          <div class="row" style="margin-top:12px"><button class="btn" id="open-data" type="button">${icon("folder")}Ouvrir le dossier</button></div>
          <p class="notes">Tout reste sur ce PC : aucune donnée n'est envoyée sur Internet. Supprimer le dossier remet l'application à zéro.</p>`, { ico: "disk" })}
      </div>
      <div class="grid cols-2">
        ${card("Apparence", html`<div class="form-row">
          <button class="btn" data-theme-set="light" type="button">${icon("sun")}Clair</button>
          <button class="btn" data-theme-set="dark" type="button">${icon("moon")}Sombre</button></div>
          <p class="notes">Par défaut, l'application suit le thème de Windows.</p>`, { ico: "settings" })}
        ${card("À propos", kv([
          ["Version", `${st.app} ${st.version}`],
          ["Mode", st.demo ? "Démonstration (données d'exemple)" : "Données réelles"],
          ["Droits", st.admin ? "Administrateur" : "Utilisateur standard"],
          ["Graphiques", "Chart.js 4.5.1 (licence MIT)"],
          ["Historique continu", "Raccourci vers « PCInsight.exe --collect » dans shell:startup"],
        ]), { ico: "info" })}
      </div>`);

    view.querySelector("#save").addEventListener("click", async () => {
      const body = { lhm_enabled: view.querySelector("#lhm-on").checked, lhm_port: Number(view.querySelector("#lhm-port").value) };
      try {
        await ctx.api.post("settings", body);
        toast("Paramètres enregistrés. Test de connexion…");
        setTimeout(async () => {
          const r = await ctx.api.get("sensors").catch(() => null);
          const l = (r && r.sources.lhm) || {};
          const box = view.querySelector("#lhm-state");
          if (box) setHTML(box, l.ok ? badge(`Connecté — version ${l.version || "?"}`, "good") : badge(l.disabled ? "Désactivé" : `Non connecté${l.error ? ` (${l.error})` : ""}`, l.disabled ? "" : "warning"));
        }, 1500);
      } catch (e) { toast(e.message); }
    });
    view.querySelector("#open-data").addEventListener("click", () => ctx.api.post("tools/open-data").catch((e) => toast(e.message)));
    view.querySelectorAll("[data-theme-set]").forEach((b) => b.addEventListener("click", () => { ctx.setTheme(b.dataset.themeSet); ctx.rerender(); }));
  },
};
