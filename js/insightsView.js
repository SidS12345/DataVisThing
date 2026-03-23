import { getFlowValue } from "./utils.js";

const INCOME_SHORT = {
  "Low Income":          "Low",
  "Lower Middle Income": "Lower middle",
  "Upper Middle Income": "Upper middle",
  "High Income":         "High"
};

const YEARS = [2015, 2016, 2017, 2018, 2019];

// Escape data-derived strings before inserting into innerHTML
function esc(s) {
  const el = document.createElement("span");
  el.textContent = s;
  return el.innerHTML;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function updateInsights(filteredData, state) {
  const el = document.getElementById("insightsList");
  if (!el) return;

  const year = state.selectedYear;

  if (filteredData.length === 0) {
    el.innerHTML = '<li class="insight-item">No data matches the current filters.</li>';
    return;
  }

  const insights = [];

  // 1. Strongest bilateral flow ──────────────────────────────────────────────
  let maxAbs = 0, maxRow = null, maxVal = 0;
  filteredData.forEach(d => {
    const v = getFlowValue(d, year);
    const abs = Math.abs(v);
    if (abs > maxAbs) { maxAbs = abs; maxRow = d; maxVal = v; }
  });

  if (maxRow) {
    insights.push(
      `Strongest flow: <strong>${esc(maxRow.base_country_name)} \u2192 ` +
      `${esc(maxRow.target_country_name)}</strong> at ${maxVal.toFixed(2)} per 10K`
    );
  }

  // 2. Top destination country ───────────────────────────────────────────────
  const destTotals = d3.rollups(
    filteredData,
    rows => d3.sum(rows, d => getFlowValue(d, year)),
    d => d.target_country_name
  ).sort((a, b) => d3.descending(a[1], b[1]));

  if (destTotals.length > 0 && destTotals[0][1] > 0) {
    insights.push(
      `Top destination: <strong>${esc(destTotals[0][0])}</strong> ` +
      `(${destTotals[0][1].toFixed(2)} per 10K total inflow)`
    );
  }

  // 3. Peak migration year ──────────────────────────────────────────────────
  //    Uses rawData with the same country/income filters but across ALL years
  //    so we can compare volumes across the full 2015-2019 range.
  const subset = state.rawData.filter(d => {
    const matchesCountry =
      state.selectedCountry === "all" ||
      d.base_country_name === state.selectedCountry ||
      d.target_country_name === state.selectedCountry;
    const matchesIncome = !state.selectedIncomeCell ||
      (d.base_country_wb_income === state.selectedIncomeCell.origin &&
       d.target_country_wb_income === state.selectedIncomeCell.dest);
    return matchesCountry && matchesIncome;
  });

  if (subset.length > 0) {
    const yearTotals = YEARS.map(y => ({
      year: y,
      total: d3.sum(subset, d => Math.abs(getFlowValue(d, y)))
    }));
    const peak = yearTotals.reduce((best, cur) =>
      cur.total > best.total ? cur : best, yearTotals[0]
    );

    if (peak.year === year) {
      insights.push(
        `${year} is the <strong>peak year</strong> for flow volume in this selection`
      );
    } else {
      insights.push(
        `Flow volume peaked in <strong>${peak.year}</strong> for this selection`
      );
    }
  }

  // 4. Dominant income pathway (or share-of-total when a cell is selected) ──
  if (!state.selectedIncomeCell) {
    const incomePairs = d3.rollups(
      filteredData,
      rows => d3.sum(rows, d => Math.abs(getFlowValue(d, year))),
      d => `${d.base_country_wb_income}|||${d.target_country_wb_income}`
    ).sort((a, b) => d3.descending(a[1], b[1]));

    if (incomePairs.length > 0) {
      const [origin, dest] = incomePairs[0][0].split("|||");
      insights.push(
        `Dominant pathway: <strong>${esc(INCOME_SHORT[origin] || origin)} \u2192 ` +
        `${esc(INCOME_SHORT[dest] || dest)}</strong> income countries`
      );
    }
  } else {
    // Income cell is selected — show what share of total it represents
    const totalAll = d3.sum(
      state.rawData.filter(d => {
        const matchesCountry =
          state.selectedCountry === "all" ||
          d.base_country_name === state.selectedCountry ||
          d.target_country_name === state.selectedCountry;
        return matchesCountry;
      }),
      d => Math.abs(getFlowValue(d, year))
    );

    if (totalAll > 0) {
      const totalSelected = d3.sum(filteredData, d => Math.abs(getFlowValue(d, year)));
      const pct = ((totalSelected / totalAll) * 100).toFixed(1);
      insights.push(
        `This income pathway accounts for <strong>${pct}%</strong> of total flow volume`
      );
    }
  }

  el.innerHTML = insights
    .map(text => `<li class="insight-item">${text}</li>`)
    .join("");
}
