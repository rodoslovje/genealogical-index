import { t } from '../i18n.js';
import { ensureChartJs } from '../utils.js';

let chartInstance = null;
let timelineChartInstance = null;

const CHART_FONT = { family: 'system-ui, -apple-system, sans-serif', size: 14, weight: '600' };

/** Top-contributors doughnut chart (top 10 + "Others"). */
export async function renderChart(data) {
  try { await ensureChartJs(); } catch { return; }
  if (!window.Chart) return;
  const ctx = document.getElementById('contributorsChart')?.getContext('2d');
  if (!ctx) return;

  const sorted = [...data].sort((a, b) => b.total - a.total);
  const top10 = sorted.slice(0, 10);
  const othersTotal = sorted.slice(10).reduce((sum, r) => sum + r.total, 0);

  const labels = top10.map(d => d.contributor_ID);
  const values = top10.map(d => d.total);

  if (othersTotal > 0) {
    labels.push(t('chart_others'));
    values.push(othersTotal);
  }

  if (chartInstance) chartInstance.destroy();

  // Vibrant, accessible colors for the chart slices
  const bgColors = ['#3498db', '#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#34495e', '#d35400', '#7f8c8d', '#bdc3c7'];

  chartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: bgColors.slice(0, labels.length),
        borderWidth: 2,
        borderColor: '#fff',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: t('tab_contributors'), font: CHART_FONT, color: '#444' },
        legend: {
          position: window.innerWidth > 600 ? 'right' : 'bottom',
          labels: { font: { family: CHART_FONT.family } },
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const val = context.parsed;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const pct = ((val / total) * 100).toFixed(1);
              return ` ${context.label}: ${val.toLocaleString()} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

/** Births/marriages/deaths timeline (per decade, stacked bar). */
export async function renderTimelineChart(data) {
  try { await ensureChartJs(); } catch { return; }
  if (!window.Chart) return;
  const ctx = document.getElementById('timelineChart')?.getContext('2d');
  if (!ctx) return;

  const decades = {};
  data.forEach(d => {
    const decade = Math.floor(d.year / 10) * 10;
    if (!decades[decade]) decades[decade] = { births: 0, marriages: 0, deaths: 0 };
    decades[decade].births += d.births;
    decades[decade].marriages += d.marriages;
    decades[decade].deaths += d.deaths;
  });

  // Fill any gaps so the timeline represents a continuous X-axis
  if (Object.keys(decades).length > 0) {
    const minDecade = Math.min(...Object.keys(decades).map(Number));
    const maxDecade = Math.max(...Object.keys(decades).map(Number));
    for (let i = minDecade; i <= maxDecade; i += 10) {
      if (!decades[i]) decades[i] = { births: 0, marriages: 0, deaths: 0 };
    }
  }

  const sortedKeys = Object.keys(decades).sort((a, b) => a - b);
  const labels = sortedKeys.map(d => `${d}`);
  const births = sortedKeys.map(d => decades[d].births);
  const marriages = sortedKeys.map(d => decades[d].marriages);
  const deaths = sortedKeys.map(d => decades[d].deaths);

  if (timelineChartInstance) timelineChartInstance.destroy();

  timelineChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: t('chart_births'),    data: births,    backgroundColor: '#3498db', borderRadius: 2 },
        { label: t('chart_marriages'), data: marriages, backgroundColor: '#2ecc71', borderRadius: 2 },
        { label: t('chart_deaths'),    data: deaths,    backgroundColor: '#e74c3c', borderRadius: 2 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 12 } },
        title: { display: true, text: t('chart_timeline'), font: CHART_FONT, color: '#444' },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
        x: { stacked: true, grid: { display: false } },
      },
    },
  });
}
