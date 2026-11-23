import { card, errorBox, html, icon, loading, meter, setHTML, toast } from "../ui.js";

const SEV = {
  critical: ["x", "Problème"], warning: ["alert", "À surveiller"], info: ["info", "Conseil"], good: ["check", "Bon point"],
};
const CAT_ICON = { performance: "activity", storage: "disk", security: "shield", stability: "alert", updates: "updates" };
const CAT_PAGE = { performance: "performance", storage: "storage", security: "security", stability: "events", updates: "updates" };
const PAGE_LABEL = {
  performance: "Performances", storage: "Stockage", security: "Sécurité", events: "Événements", updates: "Mises à jour",
  software: "Logiciels", hardware: "Matériel", sensors: "Capteurs", network: "Réseau",
};

export function scoreLabel(score) {
  if (score === null || score === undefined) return ["Pas encore de données", "info"];
  if (score >= 85) return ["Très bon état", "good"];
  if (score >= 70) return ["Bon état, quelques points à revoir", "good"];
  if (score >= 50) return ["État moyen : plusieurs points à corriger", "warning"];
  return ["Plusieurs problèmes importants", "critical"];
}

export const scoreKind = (s) => (s >= 80 ? "good" : s >= 55 ? "warning" : "critical");

export function scoreHero(a, links = false) {
  const [label, kind] = scoreLabel(a.score);
  const cats = Object.entries(a.categories);
  const row = ([key, c]) => {
    const inner = html`<span>${icon(CAT_ICON[key] || "info")} ${c.label}</span>${c.score === null ? html`<span class="muted small">pas de données</span>` : meter(c.score, { kind: scoreKind(c.score) })}<b>${c.score ?? "—"}</b>`;
    return links ? html`<a class="cat-row" href="#/${CAT_PAGE[key]}">${inner}</a>` : html`<div class="cat-row">${inner}</div>`;
  };
  return html`<div class="hero">
    <div>
      <div class="hero-score"><span class="num">${a.score ?? "—"}</span><span class="den">/100</span></div>
      <div class="hero-label ${kind}">${icon(SEV[kind][0])}${label}</div>
      <div class="small text-2" style="margin-top:6px">${a.counts.critical} problème(s) · ${a.counts.warning} à surveiller · ${a.counts.info} conseil(s) · ${a.counts.good} bon(s) point(s)</div>
    </div>
    <div class="hero-cats">${cats.map(row)}</div>
  </div>`;
}

/** Liste de constats. options : advice (afficher le conseil), links (lien vers la page). */
export function findingList(findings, { advice = true, links = true } = {}) {
  return html`<div class="findings">${findings.map((f) => html`<div class="finding ${f.severity}">
    ${icon(SEV[f.severity][0])}
    <div>
      <div class="t">${f.title}</div>
      ${f.detail ? html`<div class="d">${f.detail}</div>` : ""}
      ${advice && f.advice ? html`<div class="a"><b>Que faire :</b> ${f.advice}</div>` : ""}
      ${links && f.page ? html`<a class="go" href="#/${f.page}">Voir la page ${PAGE_LABEL[f.page] || ""} →</a>` : ""}
    </div>
  </div>`)}</div>`;
}

export default {
  title: "Diagnostic",
  subtitle: "Analyse automatique de toutes les sections, avec conseils concrets",

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
            <p class="small">Rapport HTML (imprimable en PDF depuis le navigateur : Ctrl+P) et données complètes au format JSON :</p>
            <p class="mono small">${r.html}<br>${r.json}</p>
            <div class="row"><button class="btn primary" id="open-report" type="button">${icon("external")}Ouvrir le rapport</button>
            <button class="btn" id="open-folder" type="button">${icon("folder")}Ouvrir le dossier</button></div>`, { ico: "download" }));
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
    ctx.setAnalysis(a);

    const unavailable = Object.entries(a.unavailable || {});
    const filters = [
      ["problems", "Problèmes et points à surveiller", (f) => f.severity === "critical" || f.severity === "warning"],
      ["advice", "Conseils", (f) => f.severity === "info"],
      ["good", "Bons points", (f) => f.severity === "good"],
      ["all", "Tout", () => true],
    ];
    setHTML(view, html`
      <div id="export"></div>
      <div class="grid">${card("Santé du PC", scoreHero(a, true), { ico: "report", sub: `Analyse du ${new Date(a.generated).toLocaleString("fr-FR")}` })}</div>
      ${unavailable.length ? html`<div class="banner">${icon("info")}<span>Sections non analysées : ${unavailable.map(([k, v]) => `${k} (${v})`).join(" ; ")}</span></div>` : ""}
      <div class="chips" id="chips">${filters.map(([id, label, fn], i) => html`<button type="button" data-f="${id}" class="${i === 0 ? "on" : ""}">${label}<span class="n">${a.findings.filter(fn).length}</span></button>`)}</div>
      <div id="list"></div>
      <p class="notes">Calcul du score : chaque catégorie part de 100 ; −25 par problème, −10 par point à surveiller, −3 par conseil (certains conseils purement informatifs ne retirent rien). Le score global est la moyenne des catégories. Ces seuils sont indicatifs : un point « à surveiller » n'est pas forcément gênant selon votre usage.</p>`);

    const draw = (fid) => {
      const fn = filters.find((f) => f[0] === fid)[2];
      const cats = Object.entries(a.categories).map(([key, c]) => ({ key, ...c, items: a.findings.filter((f) => f.category === key && fn(f)) }))
        .filter((c) => c.items.length);
      setHTML(view.querySelector("#list"), cats.length
        ? html`<div class="grid ${cats.length > 1 ? "cols-2" : ""}">${cats.map((c) => card(c.label, findingList(c.items), { ico: CAT_ICON[c.key], sub: c.score === null ? "" : `Score : ${c.score}/100` }))}</div>`
        : html`<div class="card"><div class="finding good">${icon("check")}<div><div class="t">Rien dans cette catégorie</div></div></div></div>`);
    };
    view.querySelector("#chips").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-f]");
      if (!b) return;
      view.querySelectorAll("#chips button").forEach((x) => x.classList.toggle("on", x === b));
      draw(b.dataset.f);
    });
    draw(a.counts.critical + a.counts.warning ? "problems" : "all");
    if (!(a.counts.critical + a.counts.warning)) view.querySelectorAll("#chips button").forEach((x) => x.classList.toggle("on", x.dataset.f === "all"));
  },
};
