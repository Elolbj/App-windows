import { DataTable, badge, card, errorBox, fmtAgo, fmtDateTime, html, icon, kv, loading, scriptNotes, setHTML, yesNo } from "../ui.js";

const ICONS = { good: "check", warning: "alert", critical: "x", unknown: "unknown" };

function check(kind, title, detail) {
  return html`<div class="check ${kind}">${icon(ICONS[kind])}<div><div class="t">${title}</div><div class="d">${detail}</div></div></div>`;
}

/** Transforme un booléen en (état, texte) ; `goodWhen` = valeur souhaitée. */
function state(value, goodWhen = true, bad = "warning") {
  if (value === null || value === undefined) return "unknown";
  return value === goodWhen ? "good" : bad;
}

export default {
  title: "Sécurité",
  subtitle: "Antivirus, pare-feu, chiffrement, comptes et exposition réseau",

  async render(view, ctx) {
    setHTML(view, loading("Lecture de l'état de sécurité…"));
    let s, net = null;
    try {
      [s, net] = await Promise.all([
        ctx.api.section("security", ctx.refresh).then((r) => r.data),
        ctx.api.section("network").then((r) => r.data).catch(() => null),
      ]);
    } catch (e) { setHTML(view, errorBox(e.message)); return; }
    if (!ctx.alive()) return;
    const d = s.defender || {};
    const reg = s.registry || {};
    const otherAv = s.antivirus.filter((a) => !/defender/i.test(a.name || ""));
    const avOn = d.realTime || otherAv.some((a) => a.enabled);
    const fwOff = s.firewall.filter((f) => !f.enabled);
    const sysDrive = s.bitlocker.find((b) => (b.drive || "").toUpperCase() === "C:");
    const sensitive = net ? (net.connections.listening || []).filter((p) => p.sensitive) : [];
    const enabledUsers = s.users.filter((u) => u.enabled);
    const sigAge = d.signatureAge;

    const checks = [
      check(avOn ? "good" : s.defender || s.antivirus.length ? "critical" : "unknown", "Antivirus en temps réel",
        d.realTime ? "Microsoft Defender actif" : otherAv.some((a) => a.enabled) ? otherAv.filter((a) => a.enabled).map((a) => a.name).join(", ") : s.defender ? "Aucune protection active détectée" : "État inconnu"),
      check(sigAge === undefined || sigAge === null || !d.realTime ? "unknown" : sigAge >= 7 ? "warning" : "good", "Définitions antivirus",
        d.signatureUpdated ? `Mises à jour ${fmtAgo(d.signatureUpdated)} (version ${d.signatureVersion})` : "Non disponible"),
      check(s.firewall.length ? (fwOff.length ? (fwOff.some((f) => f.name === "Public") ? "critical" : "warning") : "good") : "unknown", "Pare-feu Windows",
        s.firewall.length ? s.firewall.map((f) => `${f.label} : ${f.enabled ? "actif" : "désactivé"}`).join(" · ") : "État inconnu"),
      check(state(reg.uac_enabled, true, "critical") === "good" && reg.uac_never_notify ? "warning" : state(reg.uac_enabled, true, "critical"), "Contrôle de compte (UAC)",
        reg.uac_enabled === false ? "Désactivé" : reg.uac_never_notify ? "Activé mais sans notification" : reg.uac_enabled ? "Activé" : "Inconnu"),
      check(state(reg.secure_boot), "Secure Boot", reg.secure_boot ? "Démarrage vérifié par l'UEFI" : reg.secure_boot === false ? "Désactivé ou mode BIOS hérité" : "Inconnu"),
      check(sysDrive ? (sysDrive.on ? "good" : "warning") : "unknown", "Chiffrement du disque système",
        sysDrive ? `BitLocker : ${sysDrive.label}` : "Inconnu"),
      check(reg.smb1_client || reg.smb1_server ? "warning" : "good", "SMBv1 (protocole obsolète)", reg.smb1_client || reg.smb1_server ? "Présent — à désactiver" : "Absent ou désactivé"),
      check(reg.rdp_enabled ? (reg.rdp_nla === false ? "warning" : "unknown") : reg.rdp_enabled === false ? "good" : "unknown", "Bureau à distance",
        reg.rdp_enabled ? `Activé${reg.rdp_nla === false ? " sans NLA" : " (NLA active)"}` : reg.rdp_enabled === false ? "Désactivé" : "Inconnu"),
      check(state(reg.memory_integrity, true, "warning"), "Intégrité de la mémoire (HVCI)", reg.memory_integrity ? "Activée" : reg.memory_integrity === false ? "Désactivée" : "Non configurée"),
      check(d.tamperProtected === undefined ? "unknown" : state(d.tamperProtected), "Protection contre les falsifications", d.tamperProtected ? "Activée" : d.tamperProtected === false ? "Désactivée" : "Inconnu"),
      check(s.tpm ? (s.tpm.present && s.tpm.ready ? "good" : "warning") : "unknown", "Puce TPM", s.tpm ? `Présente : ${yesNo(s.tpm.present)} · prête : ${yesNo(s.tpm.ready)}` : "Lecture réservée aux administrateurs"),
      check(net ? (sensitive.length ? "warning" : "good") : "unknown", "Ports sensibles exposés",
        net ? (sensitive.length ? [...new Set(sensitive.map((p) => `${p.port} (${p.service})`))].join(", ") : "Aucun port sensible ouvert sur le réseau") : "Inconnu"),
    ];

    setHTML(view, html`
      <div class="grid">${card("Points de contrôle", html`<div class="checks">${checks}</div>`)}</div>
      <div class="grid cols-2">
        ${card("Microsoft Defender", s.defender ? kv([
          ["Service", d.serviceEnabled ? badge("Actif", "good") : badge("Arrêté", "critical")],
          ["Mode", d.runningMode],
          ["Temps réel", d.realTime ? badge("Activé", "good") : badge("Désactivé", "critical")],
          ["Signatures", `${d.signatureVersion || "?"} — ${fmtDateTime(d.signatureUpdated)}`],
          ["Dernière analyse rapide", d.lastQuickScan ? `${fmtDateTime(d.lastQuickScan)} (${fmtAgo(d.lastQuickScan)})` : "—"],
          ["Dernière analyse complète", d.fullScanAge > 100000 ? "Jamais" : `il y a ${d.fullScanAge} jour(s)`],
        ]) : html`<div class="empty">Indisponible.</div>`)}
        ${card("Antivirus déclarés", s.antivirus.length ? kv(s.antivirus.map((a) => [a.name, html`${a.enabled ? badge("Activé", "good") : badge("Désactivé", "")} ${a.up_to_date ? badge("À jour", "good") : badge("Signatures anciennes", "warning")}`]))
          : html`<div class="empty">Aucun antivirus enregistré auprès du Centre de sécurité (normal sur Windows Server).</div>`)}
      </div>
      <div class="grid cols-2">
        ${card("Comptes locaux", html`<div id="t-users"></div>`, { sub: `${enabledUsers.length} compte(s) actif(s)` })}
        ${card("Membres du groupe Administrateurs", s.admins.length ? kv(s.admins.map((a) => [a.name, `${a.type} · ${a.source}`])) : html`<div class="empty">Non disponible.</div>`)}
      </div>
      <div class="grid">${card("Volumes et BitLocker", kv(s.bitlocker.map((b) => [b.drive, b.on ? badge(b.label, "good") : badge(b.label, b.code === 2 ? "" : "info")])))}</div>
      ${scriptNotes(s.errors, ctx.status.admin)}`);

    new DataTable(view.querySelector("#t-users"), {
      rows: s.users, search: false, sortKey: "enabled", sortDir: "desc",
      columns: [
        { key: "name", label: "Compte", render: (u) => html`${u.name}${u.builtin_admin ? html` <span class="muted small">(admin intégré)</span>` : ""}${u.guest ? html` <span class="muted small">(invité)</span>` : ""}` },
        { key: "enabled", label: "État", value: (u) => (u.enabled ? 1 : 0), render: (u) => (u.enabled ? badge("Actif", u.guest ? "warning" : "good") : badge("Désactivé", "")) },
        { key: "passwordRequired", label: "Mot de passe requis", render: (u) => yesNo(u.passwordRequired) },
        { key: "lastLogon", label: "Dernière connexion", render: (u) => (u.lastLogon ? fmtDateTime(u.lastLogon) : "—") },
      ],
    });
  },
};
