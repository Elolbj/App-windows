import { card, errorBox, html, icon, loading, meter, setHTML, toast } from "../ui.js";

const SEV = {
  critical: ["x", "Critique"], warning: ["alert", "À surveiller"], info: ["info", "Information"], good: ["check", "Bon point"],
};

export function scoreLabel(score) {
  if (score === null || score === undefined) return ["Indisponible", "info"];
  if (score >= 85) return ["Très bon état", "good"];
  if (score >= 70) return ["Bon état, quelques points à revoir", "good"];
  if (score >= 50) return ["État moyen", "warning"];
  return ["Plusieurs problèmes à corriger", "critical"];
}

export const scoreKind = (s) => (s >= 80 ? "good" : s >= 55 ? "warning" : "critical");

export function scoreHero(a) {
  const [label, kind] = scoreLabel(a.score);
  const cats = Object.values(a.categories);
  return html`<div class="hero">
    <div>
      <div class="hero-score"><span class="num">${a.score ?? "—"}</span><span class="den">/100</span></div>
      <div class="hero-label ${kind}">${icon(SEV[kind][0])}${label}</div>
      <div class="small text-2" style="margin-top:6px">${a.counts.critical} critique(s) · ${a.counts.warning} à surveiller · ${a.counts.info} info(s)</div>
    </div>
    <div class="hero-cats">${cats.map((c) => html`<div class="cat-row"><span>${c.label}</span>${c.score === null ? html`<span class="muted small">pas de données</span>` : meter(c.score, { kind: scoreKind(c.score) })}<b>${c.score ?? "—"}</b></div>`)}</div>
  </div>`;
}

export function findingList(findings, showAdvice = true) {
  return html`<div class="findings">${findings.map((f) => html`<div class="finding ${f.severity}">
    ${icon(SEV[f.severity][0])}
    <div>
      <div class="t">${f.title}</div>
      ${f.detail ? html`<div class="d">${f.detail}</div>` : ""}
      ${showAdvice && f.advice ? html`<div class="a">${f.advice}</div>` : ""}
    </div>
  </div>`)}</div>`;
}

export default {
  title: "Diagnostic",
  subtitle: "Analyse automatique, conseils et rapport exportable",

  async render(view, ctx) {
    ctx.setActions(html`
      <button class="btn" id="btn-refresh" type="button">${icon("refresh")}Relancer l'analyse</button>
      <button class="btn primary" id="btn-export" type="button">${icon("download")}Exporter le rapport</button>`);
    view.ownerDocument.getElementById("btn-refresh").addEventListener("click", () => ctx.rerender(true));
    const exportBtn = view.ownerDocument.getElementById("btn-export");
    exportBtn.addEventListener("click", async () => {
      exportBtn.disabled = true;
      exportBtn.classList.add("spin");
      try {
        const r = await ctx.api.post("export");
        const box = view.querySelector("#export");
        if (box) {
          setHTML(box, card("Rapport enregistré", html`
            <p class="small">Rapport HTML (imprimable en PDF depuis le navigateur) et données complètes au format JSON :</p>
            <p class="mono small">${r.html}<br>${r.json}</p>
            <div class="row"><button class="btn primary" id="open-report" type="button">${icon("external")}Ouvrir le rapport</button>
            <button class="btn" id="open-folder" type="button">${icon("folder")}Ouvrir le dossier</button></div>`));
          box.querySelector("#open-report").addEventListener("click", () => ctx.api.post("open-report").catch((e) => toast(e.message)));
          box.querySelector("#open-folder").addEventListener("click", () => ctx.api.post("open-folder").catch((e) => toast(e.message)));
        }
      } catch (e) {
        toast(`Export impossible : ${e.message}`);
      } finally {
        exportBtn.disabled = false;
        exportBtn.classList.remove("spin");
      }
    });

    setHTML(view, loading("Analyse de toutes les sections… (jusqu'à une minute au premier lancement)"));
    let a;
    try {
      a = await ctx.api.get("analysis", { refresh: ctx.refresh ? "1" : undefined });
    } catch (e) {
      setHTML(view, errorBox(`Analyse impossible : ${e.message}`));
      return;
    }
    if (!ctx.alive()) return;
    ctx.setNavCount("analysis", a.counts.critical + a.counts.warning, a.counts.critical > 0);

    const byCat = Object.entries(a.categories).map(([key, c]) => ({ key, ...c, items: a.findings.filter((f) => f.category === key) }));
    const unavailable = Object.entries(a.unavailable || {});
    setHTML(view, html`
      <div id="export"></div>
      <div class="grid">${card("Score de santé", scoreHero(a), { sub: `Analyse du ${new Date(a.generated).toLocaleString("fr-FR")}` })}</div>
      ${unavailable.length ? html`<div class="banner">${icon("info")}<span>Sections non analysées : ${unavailable.map(([k, v]) => `${k} (${v})`).join(" ; ")}</span></div>` : ""}
      <div class="grid cols-2">
        ${byCat.map((c) => card(c.label, c.items.length ? findingList(c.items) : html`<div class="empty">Aucune donnée pour cette catégorie.</div>`,
          { sub: c.score === null ? "" : `Score : ${c.score}/100` }))}
      </div>
      <p class="notes">Le score part de 100 par catégorie : −25 par point critique, −10 par point à surveiller, −3 par information. Le score global est la moyenne des catégories. Ces règles sont indicatives : un « point à surveiller » n'est pas forcément un problème dans votre usage.</p>`);
  },
};
