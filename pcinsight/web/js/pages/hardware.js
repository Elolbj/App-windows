import { DataTable, badge, card, daysAgo, errorBox, fmtBytes, fmtDate, fmtNum, html, kv, loading, meter, scriptNotes, setHTML } from "../ui.js";

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
    ])));

    const gpuCards = h.gpu.map((g) => {
      const age = daysAgo(g.driverDate);
      return card("Carte graphique", kv([
        ["Modèle", g.name],
        ["Mémoire vidéo", g.memory ? fmtBytes(g.memory, 0) : null],
        ["Affichage", g.width ? `${g.width} × ${g.height} à ${g.refreshRate} Hz` : null],
        ["Pilote", g.driverVersion],
        ["Date du pilote", g.driverDate ? html`${fmtDate(g.driverDate)} ${age > 365 ? badge("plus d'un an", "warning") : ""}` : null],
      ]));
    });

    const used = mem.modules.length;
    const speeds = mem.modules.filter((m) => m.speed && m.configuredSpeed && m.configuredSpeed < m.speed);
    const memNotes = [];
    if (speeds.length) memNotes.push(`La mémoire fonctionne à ${speeds[0].configuredSpeed} MT/s alors qu'elle supporte ${speeds[0].speed} MT/s : activez le profil XMP/EXPO/DOCP dans le BIOS.`);
    if (used === 1 && mem.slots >= 2) memNotes.push("Une seule barrette : en ajouter une identique active le double canal (bande passante ×2).");

    setHTML(view, html`
      <div class="grid cols-cards">
        ${card("Système", kv([
          ["Fabricant", sys.manufacturer],
          ["Modèle", sys.model],
          ["Type", sys.type_label],
          ["Carte mère", `${board.manufacturer || ""} ${board.product || ""}`.trim()],
          ["BIOS / UEFI", bios.version ? `${bios.version} (${fmtDate(bios.releaseDate)})` : null],
          ["Windows installé le", fmtDate(h.os.installDate)],
          ["Architecture", h.os.architecture],
        ]))}
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
      <div class="grid">${card("Périphériques en erreur", html`<div id="dev-table"></div>`, { sub: "Équivalent des points d'exclamation du Gestionnaire de périphériques" })}</div>
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
