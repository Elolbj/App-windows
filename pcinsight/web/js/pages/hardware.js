import {
  DataTable, GLOSSARY, badge, card, daysAgo, errorBox, fmtBytes, fmtDate, fmtNum, help, html, kv, loading, meter, raw, scriptNotes, setHTML, summary,
} from "../ui.js";

export function diskHealthBadge(d) {
  const kind = d.health === 0 ? "good" : d.health === 1 ? "warning" : d.health === 2 ? "critical" : "unknown";
  return badge(d.health_label || "Inconnu", kind);
}

export function diskTable(el, disks) {
  return new DataTable(el, {
    rows: disks, search: false, pageSize: 20,
    columns: [
      { key: "name", label: "Disque" },
      { key: "media", label: "Type" },
      { key: "bus", label: "Interface" },
      { key: "size", label: "Taille", num: true, render: (d) => fmtBytes(d.size, 0) },
      { key: "health", label: "Santé", render: diskHealthBadge },
      { key: "temp", label: "Temp.", num: true, value: (d) => d.reliability?.temperature ?? "", render: (d) => (d.reliability?.temperature ? `${d.reliability.temperature} °C` : "—") },
      { key: "wear", label: "Usure", num: true, value: (d) => d.reliability?.wear ?? "", render: (d) => (d.reliability?.wear !== undefined && d.reliability?.wear !== null ? `${d.reliability.wear} %` : "—") },
      { key: "hours", label: "Heures d'utilisation", num: true, value: (d) => d.reliability?.powerOnHours ?? "", render: (d) => (d.reliability?.powerOnHours ? fmtNum(d.reliability.powerOnHours) : "—") },
    ],
  });
}

export default {
  title: "Matériel",
  subtitle: "Composants détectés par Windows (WMI/CIM)",

  async render(view, ctx) {
    setHTML(view, loading("Inventaire du matériel… (quelques secondes)"));
    let r;
    try { r = await ctx.api.section("hardware", ctx.refresh); } catch (e) { setHTML(view, errorBox(e.message)); return; }
    if (!ctx.alive()) return;
    const h = r.data;
    const sys = h.system || {}, bios = h.bios || {}, board = h.board || {}, mem = h.memory || {};

    const cpuCards = h.cpu.map((c) => card("Processeur", kv([
      ["Modèle", c.name],
      ["Cœurs / threads", `${c.cores} cœurs · ${c.threads} threads`],
      ["Fréquence de base", c.maxClockMHz ? `${fmtNum(c.maxClockMHz / 1000, 2)} GHz` : null],
      ["Cache L2 / L3", `${fmtBytes(c.l2KB * 1024, 0)} / ${fmtBytes(c.l3KB * 1024, 0)}`],
      ["Socket", c.socket],
      ["Virtualisation (BIOS)", c.virtualization ? badge("Activée", "good") : badge("Désactivée", "info")],
    ]), { ico: "cpu" }));

    const gpuCards = h.gpu.map((g) => {
      const age = daysAgo(g.driverDate);
      return card("Carte graphique", kv([
        ["Modèle", g.name],
        ["Mémoire vidéo", g.memory ? fmtBytes(g.memory, 0) : null],
        ["Affichage", g.width ? `${g.width} × ${g.height} à ${g.refreshRate} Hz` : null],
        ["Pilote", g.driverVersion],
        ["Date du pilote", g.driverDate ? html`${fmtDate(g.driverDate)} ${age > 365 ? badge("plus d'un an", "warning") : ""}` : null],
      ]), { ico: "gpu" });
    });

    const used = mem.modules.length;
    const speeds = mem.modules.filter((m) => m.speed && m.configuredSpeed && m.configuredSpeed < m.speed);
    const memNotes = [];
    if (speeds.length) memNotes.push(`La mémoire fonctionne à ${speeds[0].configuredSpeed} MT/s alors qu'elle supporte ${speeds[0].speed} MT/s : activez le profil XMP/EXPO/DOCP dans le BIOS.`);
    if (used === 1 && mem.slots >= 2) memNotes.push("Une seule barrette : en ajouter une identique active le double canal (bande passante ×2).");

    const problems = h.problem_devices.filter((p) => !p.disabled);
    const badDisks = h.disks.filter((d) => d.health === 1 || d.health === 2);
    setHTML(view, html`
      ${summary([
        { kind: badDisks.length ? "critical" : "good", title: badDisks.length ? `${badDisks.length} disque(s) en mauvaise santé` : "Disques en bonne santé", text: badDisks.length ? "Sauvegardez vos données." : `${h.disks.length} disque(s) déclaré(s) sains par Windows.` },
        { kind: problems.length ? "warning" : "good", title: problems.length ? `${problems.length} périphérique(s) en erreur` : "Tous les périphériques fonctionnent", text: problems.length ? problems.slice(0, 2).map((p) => p.name).join(", ") : "Aucune erreur dans le Gestionnaire de périphériques." },
        memNotes.length ? { kind: "info", title: "Mémoire améliorable", text: memNotes[0] } : { kind: "good", title: "Mémoire bien configurée", text: `${used} barrette(s), ${fmtBytes(mem.total || sys.totalMemory, 0)}.` },
      ])}
      <div class="grid cols-cards">
        ${card("Système", kv([
          ["Fabricant", sys.manufacturer],
          ["Modèle", sys.model],
          ["Type", sys.type_label],
          ["Carte mère", `${board.manufacturer || ""} ${board.product || ""}`.trim()],
          ["BIOS / UEFI", bios.version ? `${bios.version} (${fmtDate(bios.releaseDate)})` : null],
          ["Windows installé le", fmtDate(h.os.installDate)],
          ["Architecture", h.os.architecture],
        ]) , { ico: "settings" })}
        ${cpuCards}
        ${gpuCards}
        ${card("Mémoire vive", html`
          ${kv([
            ["Total installé", fmtBytes(mem.total || sys.totalMemory, 0)],
            ["Emplacements", mem.slots ? `${used} utilisé(s) sur ${mem.slots}` : `${used} barrette(s)`],
            ["Capacité maximale", mem.max_capacity ? fmtBytes(mem.max_capacity, 0) : null],
            ["Type", [...new Set(mem.modules.map((m) => m.type).filter(Boolean))].join(", ")],
          ])}
          ${mem.slots ? html`<div style="margin-top:10px">${meter((100 * used) / mem.slots, { kind: "good" })}</div>` : ""}
          ${memNotes.length ? html`<ul class="notes">${memNotes.map((n) => html`<li>${n}</li>`)}</ul>` : ""}`)}
        ${h.battery.map((b) => card("Batterie", html`${kv([
          ["Charge", `${b.charge} %`],
          ["État", b.status_label],
          ["Santé", b.health !== null ? `${b.health} % de la capacité d'origine` : "Inconnue (droits admin requis)"],
          ["Capacité d'origine", b.designCapacity ? `${fmtNum(b.designCapacity)} mWh` : null],
          ["Capacité actuelle", b.fullCapacity ? `${fmtNum(b.fullCapacity)} mWh` : null],
          ["Cycles", b.cycleCount ? fmtNum(b.cycleCount) : null],
        ])}${b.health !== null ? html`<div style="margin-top:10px">${meter(b.health, { invert: true, warn: 30, crit: 50 })}</div>` : ""}`))}
        ${card("Écrans", h.monitors.length ? kv(h.monitors.map((m, i) => [`Écran ${i + 1}`, `${m.name || "?"} (${m.manufacturer || "?"}${m.year ? `, ${m.year}` : ""})`])) : html`<div class="empty">Aucun écran identifié.</div>`)}
        ${card("Cartes réseau", kv(h.network_adapters.map((n) => [n.connection || "Carte", html`${n.name}<br><span class="muted small">${n.mac || ""}${n.speed ? ` · ${fmtNum(n.speed / 1e6)} Mbit/s` : ""}${n.enabled ? "" : " · déconnectée"}</span>`])))}
        ${card("Audio", kv(h.sound.map((s, i) => [`Périphérique ${i + 1}`, s.name])))}
      </div>
      <div class="grid">${card("Barrettes de mémoire", html`<div id="ram-table"></div>`)}</div>
      <div class="grid">${card("Disques physiques", html`<div id="disk-table"></div>${h.disks.some((d) => d.reliability) ? "" : html`<p class="notes">Température, usure et heures d'utilisation : relancez l'application en administrateur.</p>`}`)}</div>
      <div class="grid">${card("Périphériques en erreur", html`<div id="dev-table"></div>`, { ico: "alert", sub: "Équivalent des points d'exclamation du Gestionnaire de périphériques" })}</div>
      <div class="grid">${card("Pilotes tiers installés", html`<div id="drv">${loading("Lecture des pilotes… (5 à 15 s)")}</div>`, { ico: "settings", sub: "Pilotes non fournis par Microsoft : version, date, signature" })}</div>
      <div class="grid">${card("Démarrage et alimentation", html`<div id="osi">${loading()}</div>`, { ico: "power" })}</div>
      ${scriptNotes(h.errors, ctx.status.admin)}`);

    new DataTable(view.querySelector("#ram-table"), {
      rows: mem.modules, search: false,
      columns: [
        { key: "slot", label: "Emplacement" },
        { key: "capacity", label: "Capacité", num: true, render: (m) => fmtBytes(m.capacity, 0) },
        { key: "type", label: "Type" },
        { key: "speed", label: "Vitesse max", num: true, render: (m) => (m.speed ? `${m.speed} MT/s` : "—") },
        { key: "configuredSpeed", label: "Vitesse actuelle", num: true, render: (m) => (m.configuredSpeed ? `${m.configuredSpeed} MT/s` : "—") },
        { key: "manufacturer", label: "Fabricant" },
        { key: "partNumber", label: "Référence" },
      ],
    });
    diskTable(view.querySelector("#disk-table"), h.disks);
    ctx.api.section("drivers").then(({ data }) => {
      if (!ctx.alive()) return;
      const el = view.querySelector("#drv");
      const unsigned = data.drivers.filter((d) => d.signed === false).length;
      setHTML(el, html`<p class="small text-2">${fmtNum(data.drivers.length)} pilote(s) tiers sur ${fmtNum(data.total)} au total${unsigned ? html` — ${badge(`${unsigned} non signé(s)`, "critical")}` : " — tous signés."}</p><div id="drv-table"></div>`);
      new DataTable(el.querySelector("#drv-table"), {
        rows: data.drivers, sortKey: "class", pageSize: 25,
        columns: [
          { key: "device", label: "Périphérique" },
          { key: "class", label: "Classe", cls: "nowrap" },
          { key: "provider", label: "Éditeur" },
          { key: "version", label: "Version", cls: "mono" },
          { key: "date", label: "Date", cls: "nowrap", render: (d) => html`${fmtDate(d.date)}${daysAgo(d.date) > 3 * 365 ? html` <span class="tag">ancien</span>` : ""}` },
          { key: "signed", label: "Signature", value: (d) => (d.signed ? 1 : 0), render: (d) => (d.signed ? badge("Signé", "good") : badge("Non signé", "critical")) },
        ],
      });
    }).catch((e) => setHTML(view.querySelector("#drv"), errorBox(e.message)));

    ctx.api.section("osinfo").then(({ data: o }) => {
      if (!ctx.alive()) return;
      const boots = o.boots || [];
      const avg = boots.length ? boots.slice(-5).reduce((a, b) => a + b.seconds, 0) / Math.min(5, boots.length) : null;
      setHTML(view.querySelector("#osi"), html`${kv([
        ["Firmware", o.firmware],
        ["Activation de Windows", o.activation ? badge(o.activation.label, o.activation.status === 1 ? "good" : "warning") : null],
        ["Mode d'alimentation", o.power && o.power.name ? `${o.power.name}${o.power.mode ? ` · ${o.power.mode}` : ""}` : null],
        ["Démarrage rapide", o.fast_startup === null || o.fast_startup === undefined ? null : html`${o.fast_startup ? "Activé" : "Désactivé"} ${raw(String(help(GLOSSARY.fastStartup)))}`],
        ["Veille prolongée", o.hibernation === null || o.hibernation === undefined ? null : (o.hibernation ? "Disponible" : "Désactivée")],
        ["Durée moyenne de démarrage", avg ? `${fmtNum(avg, 0)} s (sur les ${Math.min(5, boots.length)} derniers)` : "Inconnue (droits administrateur requis)"],
        ["Points de restauration", o.restore_points && o.restore_points.length ? `${o.restore_points.length} — dernier le ${fmtDate(o.restore_points[0].time)}` : "Aucun ou non lisible (admin)"],
        ["Fuseau horaire", o.timezone],
      ])}${scriptNotes(o.errors, ctx.status.admin)}`);
    }).catch((e) => setHTML(view.querySelector("#osi"), errorBox(e.message)));

    new DataTable(view.querySelector("#dev-table"), {
      rows: h.problem_devices, search: false, empty: "Aucun périphérique en erreur.",
      columns: [
        { key: "name", label: "Périphérique", render: (p) => p.name || p.deviceId },
        { key: "class", label: "Classe" },
        { key: "label", label: "Problème", render: (p) => badge(p.label, p.disabled ? "info" : "warning") },
        { key: "code", label: "Code", num: true },
      ],
    });
  },
};
