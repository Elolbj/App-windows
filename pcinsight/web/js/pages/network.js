import { bars, colors, legend, timeLine } from "../charts.js";
import {
  DataTable, GLOSSARY, badge, card, errorBox, fmtBytes, fmtNum, fmtRate, html, kv, loading, raw, scriptNotes, setHTML, summary, tile,
} from "../ui.js";

const CATEGORY = { Public: ["Public", "info"], Private: ["Privé", "good"], DomainAuthenticated: ["Domaine", "good"] };
const STATES = { ESTABLISHED: "Établie", TIME_WAIT: "Attente (TIME_WAIT)", CLOSE_WAIT: "Fermeture (CLOSE_WAIT)", SYN_SENT: "Ouverture (SYN_SENT)", FIN_WAIT1: "FIN_WAIT1", FIN_WAIT2: "FIN_WAIT2", LAST_ACK: "LAST_ACK", NONE: "Aucun" };

export default {
  title: "Réseau",
  subtitle: "Interfaces, débit, ports ouverts et connexions",

  async render(view, ctx) {
    setHTML(view, loading());
    let n, conf = {};
    try {
      [n, conf] = await Promise.all([
        ctx.api.section("network", ctx.refresh).then((r) => r.data),
        ctx.api.section("netconfig", ctx.refresh).then((r) => r.data || {}).catch(() => ({})),
      ]);
    } catch (e) { setHTML(view, errorBox(e.message)); return; }
    if (!ctx.alive()) return;
    const c = colors();
    const up = n.interfaces.filter((i) => i.up && !i.loopback);
    const main = up.find((i) => i.ipv4.length) || up[0];
    const gw = (conf.gateways || []).find((g) => g.nextHop && !g.nextHop.includes(":")) || (conf.gateways || [])[0];
    const dns = (conf.dns || []).filter((d) => d.family === 2).flatMap((d) => d.servers);
    const profile = (conf.profiles || [])[0];
    const cn = n.connections || {};
    const exposed = (cn.listening || []).filter((p) => p.exposed);

    const w = n.wifi;
    const sigKind = w && w.signal !== null ? (w.signal >= 70 ? "good" : w.signal >= 45 ? "warning" : "critical") : null;
    const sensitive = exposed.filter((p) => p.sensitive);
    setHTML(view, html`
      ${summary([
        { kind: main && main.ipv4.length ? "good" : "critical", title: main && main.ipv4.length ? `Connecté via ${main.name}` : "Pas de connexion active", text: profile ? `Réseau « ${profile.network} » (profil ${(CATEGORY[profile.category] || [profile.category])[0]}), accès ${profile.ipv4 === "Internet" ? "à Internet" : profile.ipv4}.` : "" },
        w ? { kind: sigKind || "info", title: `Wi-Fi : signal ${w.signal !== null ? `${w.signal} %` : "inconnu"}`, text: [w.band, w.radio, w.rx_rate ? `${fmtNum(w.rx_rate)} Mbit/s` : ""].filter(Boolean).join(" · ") + (sigKind === "critical" ? " — rapprochez-vous de la box ou utilisez le 2,4 GHz." : "") } : null,
        { kind: sensitive.length ? "warning" : "good", title: `${exposed.length} port(s) ouverts sur le réseau`, text: sensitive.length ? `Dont ${sensitive.length} sensible(s) : ${[...new Set(sensitive.map((p) => p.port))].join(", ")}.` : "Aucun port sensible exposé." },
      ])}
      <div class="grid cols-6">
        ${tile("Adresse IPv4", main && main.ipv4[0] ? main.ipv4[0] : "—", { ico: "network", hint: main ? main.name : "aucune interface active" })}
        ${tile("Passerelle", gw ? gw.nextHop : "—", { hint: gw ? gw.interface : "" })}
        ${tile("DNS", dns[0] || "—", { hint: dns.length > 1 ? `+ ${dns.slice(1).join(", ")}` : "" })}
        ${tile("Réseau", profile ? profile.network : "—", { hint: profile ? `profil ${(CATEGORY[profile.category] || [profile.category])[0]} · ${profile.ipv4}` : "" })}
        ${n.wifi ? tile("Wi-Fi", n.wifi.ssid, { hint: n.wifi.signal !== null ? `signal ${n.wifi.signal} %` : "" }) : ""}
        ${tile("Ports en écoute", fmtNum((cn.listening || []).length), { hint: `${exposed.length} accessibles depuis le réseau` })}
      </div>
      <div class="grid cols-3">
        ${card("Débit en direct", html`<div class="legend">${raw(legend([["Réception", c.series[2]], ["Envoi", c.series[6]]], "line"))}</div><div class="chart"><canvas id="c-net"></canvas></div>`, { cls: "span-2", sub: "3 dernières minutes" })}
        ${card("Connexions TCP", html`<div class="chart"><canvas id="c-states"></canvas></div>`, { sub: "Par état" })}
      </div>
      ${w ? html`<div class="grid">${card(`Wi-Fi — ${w.ssid}`, kv([
        ["Signal", w.signal !== null ? `${w.signal} %` : null],
        ["Bande / canal", [w.band, w.channel ? `canal ${w.channel}` : ""].filter(Boolean).join(" · ")],
        ["Norme", w.radio ? `${w.radio}${/ax|be/.test(w.radio) ? " (Wi-Fi 6/7)" : /ac/.test(w.radio) ? " (Wi-Fi 5)" : /n$/.test(w.radio) ? " (Wi-Fi 4)" : ""}` : null],
        ["Débit de réception / d'émission", w.rx_rate ? `${fmtNum(w.rx_rate)} / ${fmtNum(w.tx_rate)} Mbit/s` : null],
        ["Sécurité", [w.auth, w.cipher].filter(Boolean).join(" · ")],
        ["Carte", w.adapter],
        ["Point d'accès (BSSID)", w.bssid],
      ]), { ico: "wifi", sub: "Connexion sans fil active (netsh)" })}</div>` : ""}
      <div class="grid">${card("Interfaces", html`<div id="t-if"></div>`, { ico: "network" })}</div>
      <div class="grid">${card("Ports en écoute", html`<div id="t-ports"></div>
        <p class="notes">« Réseau » = le port accepte des connexions venant d'autres machines (le pare-feu peut encore les bloquer). « Local » = uniquement depuis ce PC. Vérification externe : nmap -sV &lt;adresse du PC&gt; depuis une autre machine du réseau.</p>`,
        { ico: "shield", tip: GLOSSARY.exposed, sub: "Services qui attendent des connexions entrantes" })}</div>
      <div class="grid cols-2">
        ${card("Processus les plus connectés", html`<div class="chart"><canvas id="c-proc"></canvas></div>`, { sub: "Connexions TCP établies" })}
        ${card("Configuration", html`${kv([
          ["Nom d'hôte", n.hostname],
          ...(conf.profiles || []).map((p) => [`Profil ${p.interface}`, html`${p.network} ${badge((CATEGORY[p.category] || [p.category, ""])[0], (CATEGORY[p.category] || ["", ""])[1])}`]),
          ...(conf.dns || []).map((d) => [`DNS ${d.interface} (${d.family === 2 ? "IPv4" : "IPv6"})`, d.servers.join(", ")]),
          ...(conf.gateways || []).map((g) => [`Passerelle ${g.interface}`, g.nextHop]),
        ])}${scriptNotes(conf.errors, ctx.status.admin)}`)}
      </div>`);

    new DataTable(view.querySelector("#t-if"), {
      rows: n.interfaces, search: false,
      columns: [
        { key: "name", label: "Interface" },
        { key: "up", label: "État", value: (i) => (i.up ? 1 : 0), render: (i) => (i.up ? badge("Active", "good") : badge("Inactive", "")) },
        { key: "speed", label: "Vitesse", num: true, render: (i) => (i.speed ? `${fmtNum(i.speed)} Mbit/s` : "—") },
        { key: "ipv4", label: "IPv4", value: (i) => i.ipv4.join(", "), cls: "mono" },
        { key: "ipv6", label: "IPv6", value: (i) => i.ipv6.join(", "), cls: "mono clip" },
        { key: "mac", label: "MAC", cls: "mono", render: (i) => i.mac || "—" },
        { key: "recv", label: "Reçu", num: true, render: (i) => fmtBytes(i.recv) },
        { key: "sent", label: "Envoyé", num: true, render: (i) => fmtBytes(i.sent) },
      ],
    });
    new DataTable(view.querySelector("#t-ports"), {
      rows: cn.listening || [], sortKey: "port", pageSize: 40, empty: cn.error || "Aucun port en écoute.",
      columns: [
        { key: "proto", label: "Protocole" },
        { key: "port", label: "Port", num: true },
        { key: "ip", label: "Adresse", cls: "mono" },
        { key: "service", label: "Service probable", render: (p) => p.service || "—" },
        { key: "process", label: "Processus", render: (p) => (p.process ? `${p.process} (${p.pid})` : p.pid ? `PID ${p.pid}` : "—") },
        { key: "exposed", label: "Exposition", value: (p) => (p.sensitive ? 2 : p.exposed ? 1 : 0), render: (p) => (p.sensitive ? badge("Réseau · sensible", "warning") : p.exposed ? badge("Réseau", "info") : badge("Local", "good")) },
      ],
    });

    const states = cn.states || [];
    ctx.chart(bars(view.querySelector("#c-states"), {
      labels: states.map(([s]) => STATES[s] || s), datasets: [{ label: "Connexions", data: states.map(([, v]) => v), color: c.series[0] }], horizontal: true,
    }));
    const byProc = cn.by_process || [];
    ctx.chart(bars(view.querySelector("#c-proc"), {
      labels: byProc.map(([p]) => p), datasets: [{ label: "Connexions", data: byProc.map(([, v]) => v), color: c.series[2] }], horizontal: true,
    }));

    // débit en direct
    const chart = ctx.chart(timeLine(view.querySelector("#c-net"), {
      series: [{ label: "Réception", color: c.series[2], data: [], area: true }, { label: "Envoi", color: c.series[6], data: [] }],
      yFormat: (v) => fmtRate(v),
    }));
    let last = 0;
    const tick = async () => {
      let r;
      try { r = await ctx.api.get("live", { since: last }); } catch { return; }
      if (!ctx.alive() || !r.points.length) return;
      last = r.points[r.points.length - 1].t;
      const cut = Date.now() - 180000;
      const [down, upS] = chart.data.datasets;
      r.points.forEach((p) => { down.data.push({ x: p.t * 1000, y: p.net_down }); upS.data.push({ x: p.t * 1000, y: p.net_up }); });
      chart.data.datasets.forEach((ds) => { while (ds.data.length && ds.data[0].x < cut) ds.data.shift(); });
      chart.options.scales.x.min = cut;
      chart.options.scales.x.max = Date.now();
      chart.update("none");
    };
    tick();
    ctx.every(2000, tick);
  },
};
