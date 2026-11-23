import { colors, legend, timeLine } from "../charts.js";
import { GLOSSARY, card, errorBox, fmtBytes, fmtNum, fmtPct, html, loading, meter, raw, setHTML, summary, tile } from "../ui.js";
import { diskTable } from "./hardware.js";

export default {
  title: "Stockage",
  subtitle: "Volumes, espace libre, disques physiques et fichiers temporaires",

  async render(view, ctx) {
    setHTML(view, loading());
    let s;
    try { s = (await ctx.api.section("storage", ctx.refresh)).data; } catch (e) { setHTML(view, errorBox(e.message)); return; }
    if (!ctx.alive()) return;
    const temp = s.temp.reduce((n, t) => n + t.size, 0);
    const parts = [...s.partitions].sort((a, b) => (b.system - a.system) || a.mount.localeCompare(b.mount));

    const sysPart = parts.find((p) => p.system);
    const low = parts.filter((p) => !p.removable && p.total >= 1024 ** 3 && p.free / p.total < 0.15);
    setHTML(view, html`
      ${summary([
        sysPart ? { kind: sysPart.free / sysPart.total < 0.1 ? "critical" : sysPart.free / sysPart.total < 0.2 ? "warning" : "good", title: `Disque système : ${fmtBytes(sysPart.free)} libres`, text: `${fmtPct(100 - sysPart.percent)} d'espace libre. Gardez au moins 15 à 20 % pour les mises à jour et la mémoire virtuelle.` } : null,
        { kind: low.length ? "warning" : "good", title: low.length ? `${low.length} volume(s) presque plein(s)` : "Espace suffisant sur tous les volumes", text: low.map((p) => p.mount).join(", ") },
        { kind: temp > 3 * 1024 ** 3 ? "info" : "good", title: `${fmtBytes(temp)} de fichiers temporaires`, text: temp > 3 * 1024 ** 3 ? "Récupérables avec le nettoyage de disque." : "Rien à nettoyer en priorité." },
      ])}
      <div class="grid cols-4">
        ${tile("Capacité totale", fmtBytes(s.total), { ico: "disk", hint: `${parts.filter((p) => !p.removable).length} volume(s) fixe(s)` })}
        ${tile("Espace utilisé", fmtBytes(s.used), { hint: s.total ? fmtPct((100 * s.used) / s.total) : "", meter: meter(s.total ? (100 * s.used) / s.total : 0) })}
        ${tile("Espace libre", fmtBytes(s.free), { hint: "tous volumes fixes" })}
        ${tile("Fichiers temporaires", fmtBytes(temp), { hint: s.temp.some((t) => !t.complete) ? "estimation (analyse limitée)" : `${s.temp.length} dossier(s)` })}
      </div>
      <div class="grid cols-2">
        ${card("Volumes", html`${parts.map((p) => {
          const freePct = p.total ? (100 * p.free) / p.total : 0;
          return html`<div class="volume">
            <div class="top"><span class="name">${p.mount}${p.label ? ` — ${p.label}` : ""}</span><span class="small text-2">${fmtBytes(p.free)} libres sur ${fmtBytes(p.total)}</span></div>
            ${meter(p.percent, { warn: 80, crit: 90 })}
            <div class="small muted">${p.fstype || "?"}${p.system ? " · volume système" : ""}${p.removable ? " · amovible" : ""} · ${fmtPct(p.percent)} utilisé${freePct < 10 ? " · espace critique" : ""}</div>
          </div>`;
        })}`)}
        ${card("Évolution de l'espace utilisé", html`<div class="legend" id="leg"></div><div class="chart tall" id="evo"><canvas></canvas></div>`, { sub: "30 derniers jours, une mesure par heure quand l'application tourne" })}
      </div>
      <div class="grid">${card("Disques physiques", html`<div id="disks">${loading()}</div>`, { ico: "disk" })}</div>
      <div class="grid">${card("Activité en direct", html`<div id="activity" class="empty">Mesure indisponible sur ce système.</div>`, { ico: "activity", tip: GLOSSARY.diskBusy, sub: "Taux d'activité et temps de réponse de chaque disque, actualisés toutes les 3 s" })}</div>
      <div class="grid">${card("Dossiers temporaires", html`${s.temp.map((t) => html`<div class="volume"><div class="top"><span class="mono">${t.path}</span><span>${fmtBytes(t.size)}</span></div><div class="small muted">${t.files} fichier(s)${t.complete ? "" : " — analyse interrompue (dossier très volumineux)"}</div></div>`)}
        <p class="notes">Pour nettoyer : Paramètres → Système → Stockage → Fichiers temporaires, ou « cleanmgr » (Nettoyage de disque).</p>`)}</div>`);

    ctx.api.get("history", { range: "30d" }).then((h) => {
      if (!ctx.alive()) return;
      const mounts = Object.keys(h.disk).filter((m) => h.disk[m].length > 1).slice(0, 8);
      const box = view.querySelector("#evo");
      if (!mounts.length) {
        box.outerHTML = '<div class="empty">Pas encore assez de mesures (au moins deux, à une heure d\'intervalle).</div>';
        return;
      }
      const c = colors();
      setHTML(view.querySelector("#leg"), raw(legend(mounts.map((m, i) => [m, c.series[i]]), "line")));
      const fmt = (v) => new Date(v).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
      ctx.chart(timeLine(box.querySelector("canvas"), {
        series: mounts.map((m, i) => ({ label: m, color: c.series[i], data: h.disk[m].map((p) => ({ x: p.t * 1000, y: p.used })), spanGaps: 6 * 3600000 })),
        yFormat: (v) => fmtBytes(v, 0), xFormat: (v, full) => (full ? new Date(v).toLocaleString("fr-FR") : fmt(v)),
      }));
    }).catch(() => {});

    const activity = async () => {
      let r;
      try { r = await ctx.api.get("counters"); } catch { return; }
      const disks = (r.data && r.data.disks) || [];
      const box = view.querySelector("#activity");
      if (!ctx.alive() || !box || !disks.length) return;
      box.classList.remove("empty");
      setHTML(box, html`${disks.map((x) => html`<div class="volume">
        <div class="top"><span class="name">Disque ${x.name}</span><span class="small text-2">temps de réponse ${fmtNum(x.latency_ms, 1)} ms</span></div>
        ${meter(x.busy, { warn: 60, crit: 90 })}<div class="small muted">${fmtPct(x.busy)} d'activité</div></div>`)}`);
    };
    activity();
    ctx.every(3000, activity);

    ctx.api.section("hardware").then(({ data }) => {
      if (ctx.alive()) diskTable(view.querySelector("#disks"), data.disks);
    }).catch((e) => setHTML(view.querySelector("#disks"), errorBox(e.message)));
  },
};
