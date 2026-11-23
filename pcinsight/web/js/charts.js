// Graphiques Chart.js : thème commun (couleurs lues dans les variables CSS) et fabriques.
// Règles : traits de 2 px, barres <= 24 px arrondies côté valeur, grille discrète,
// une seule échelle verticale par graphique, légende dès 2 séries.

/* global Chart */
import { esc, fmtNum, fmtTime } from "./ui.js";

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function colors() {
  return {
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => css(`--series-${i}`)),
    good: css("--good"), warning: css("--warning"), serious: css("--serious"), critical: css("--critical"),
    text: css("--text"), text2: css("--text-2"), muted: css("--muted"), grid: css("--grid"),
    baseline: css("--baseline"), surface: css("--surface"),
  };
}

export function alpha(hex, a) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Ligne verticale qui suit le survol (lignes et aires)
const crosshair = {
  id: "crosshair",
  afterDatasetsDraw(chart) {
    const active = chart.tooltip && chart.tooltip.getActiveElements();
    if (!active || !active.length || chart.config.type !== "line") return;
    const x = active[0].element.x;
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = colors().baseline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();
  },
};

// Valeur écrite au bout de chaque barre horizontale (lecture directe, sans survol)
const valueLabels = {
  id: "valueLabels",
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || !opts.enabled) return;
    const ctx = chart.ctx;
    const c = colors();
    ctx.save();
    ctx.font = `600 12px ${getComputedStyle(document.body).fontFamily}`;
    ctx.fillStyle = c.text2;
    ctx.textBaseline = "middle";
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden) return;
      meta.data.forEach((el, i) => {
        const v = ds.data[i];
        if (v === null || v === undefined) return;
        ctx.fillText(opts.format ? opts.format(v) : fmtNum(v), el.x + 6, el.y);
      });
    });
    ctx.restore();
  },
};

let registered = false;
export function applyTheme() {
  if (typeof Chart === "undefined") return;
  const c = colors();
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 12;
  Chart.defaults.color = c.text2;
  Chart.defaults.borderColor = c.grid;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.legend.display = false; // légendes HTML (voir legend())
  Chart.defaults.plugins.tooltip.backgroundColor = c.surface;
  Chart.defaults.plugins.tooltip.titleColor = c.text;
  Chart.defaults.plugins.tooltip.bodyColor = c.text2;
  Chart.defaults.plugins.tooltip.borderColor = c.baseline;
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.boxPadding = 4;
  Chart.defaults.plugins.tooltip.usePointStyle = true;
  Chart.defaults.animation.duration = 250;
  if (!registered) { Chart.register(crosshair, valueLabels); registered = true; }
}

function scaleY({ max, min = 0, format, stacked = false, grid = true } = {}) {
  const c = colors();
  return {
    min, max, stacked, beginAtZero: true,
    border: { display: false },
    grid: { color: c.grid, drawTicks: false, display: grid },
    ticks: { padding: 8, maxTicksLimit: 6, callback: format || ((v) => fmtNum(v)), color: c.muted },
  };
}

function scaleX({ format, stacked = false, linear = false, min, max, maxTicks = 8 } = {}) {
  const c = colors();
  return {
    type: linear ? "linear" : "category",
    min, max, stacked,
    border: { color: c.baseline },
    grid: { display: false },
    ticks: { color: c.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: maxTicks, padding: 6, ...(format ? { callback: format } : {}) },
  };
}

/**
 * Courbes temporelles (x = horodatage en ms).
 * series : [{ label, color, data: [{x, y}], area }]
 */
export function timeLine(canvas, { series, yMax, yFormat, tooltipFormat, xFormat = fmtTime, animate = false }) {
  const c = colors();
  return new Chart(canvas, {
    type: "line",
    data: {
      datasets: series.map((s) => ({
        label: s.label, data: s.data, borderColor: s.color, backgroundColor: alpha(s.color, 0.1),
        fill: s.area ? "origin" : false, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4,
        pointHoverBorderWidth: 2, pointHoverBorderColor: c.surface, pointHoverBackgroundColor: s.color,
        tension: 0.25, borderJoinStyle: "round", borderCapStyle: "round", spanGaps: s.spanGaps ?? 120000,
      })),
    },
    options: {
      animation: animate ? undefined : false,
      parsing: false, normalized: true,
      interaction: { mode: "index", intersect: false },
      scales: { x: scaleX({ linear: true, format: (v) => xFormat(v) }), y: scaleY({ max: yMax, format: yFormat }) },
      plugins: {
        tooltip: {
          callbacks: {
            title: (items) => (items.length ? xFormat(items[0].parsed.x, true) : ""),
            label: (item) => ` ${item.dataset.label} : ${(tooltipFormat || yFormat || fmtNum)(item.parsed.y)}`,
          },
        },
      },
    },
  });
}

/**
 * Barres (verticales ou horizontales, éventuellement empilées).
 * datasets : [{ label, data, color | colors }]
 */
export function bars(canvas, { labels, datasets, horizontal = false, stacked = false, format, max, maxTicks, onClick, values }) {
  const showValues = values ?? (horizontal && !stacked && datasets.length === 1);
  const c = colors();
  const last = datasets.length - 1;
  return new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        label: d.label, data: d.data,
        backgroundColor: d.colors || d.color, hoverBackgroundColor: d.colors || d.color,
        maxBarThickness: 24, categoryPercentage: 0.8, barPercentage: 0.9,
        // arrondi côté valeur uniquement ; en empilé, seul le segment du haut est arrondi
        borderRadius: stacked && i !== last ? 0 : 4,
        borderSkipped: "start",
        // séparation de 2 px couleur de fond entre segments empilés
        borderColor: c.surface,
        borderWidth: stacked ? (horizontal ? { right: 2 } : { top: 2 }) : 0,
      })),
    },
    options: {
      indexAxis: horizontal ? "y" : "x",
      layout: { padding: { right: showValues ? 44 : 0 } },
      interaction: { mode: "index", intersect: false, axis: horizontal ? "y" : "x" },
      onClick,
      scales: horizontal
        ? { x: scaleY({ format, stacked, max }), y: { ...scaleX({ stacked }), ticks: { color: c.text2, autoSkip: false, callback(v) { const l = this.getLabelForValue(v); return l.length > 20 ? l.slice(0, 19) + "…" : l; } } } }
        : { x: scaleX({ stacked, maxTicks }), y: scaleY({ format, stacked, max }) },
      plugins: {
        valueLabels: { enabled: showValues, format },
        tooltip: {
          callbacks: { label: (item) => ` ${item.dataset.label} : ${(format || fmtNum)(horizontal ? item.parsed.x : item.parsed.y)}` },
        },
      },
    },
  });
}

/** Légende HTML : pastille de couleur + texte (le texte garde la couleur de l'encre). */
export function legend(items, kind = "box") {
  return items.map(([label, color]) => `<span><i class="${kind === "line" ? "line" : ""}" style="background:${color}"></i>${esc(label)}</span>`).join("");
}
