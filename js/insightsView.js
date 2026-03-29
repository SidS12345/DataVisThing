// insightsView.js
// Computes and renders the 4 key insight bullets shown at the top
// of the dashboard. These update every time the filters change.

import { getFlowValue } from './utils.js';

const INCOME_SHORT = {
  'Low Income': 'Low',
  'Lower Middle Income': 'Lower middle',
  'Upper Middle Income': 'Upper middle',
  'High Income': 'High'
};

const YEARS = [2015, 2016, 2017, 2018, 2019];

// html-escape strings before putting them in innerHTML
function esc(str) {
  const span = document.createElement('span');
  span.textContent = str;
  return span.innerHTML;
}

export function updateInsights(filteredData, state) {
  const container = document.getElementById('insightsList');
  if (!container) return;

  const year = state.selectedYear;

  // show a message if no data matches the current filters
  if (filteredData.length === 0) {
    container.innerHTML = '<li class="insight-item">No data matches the current filters.</li>';
    return;
  }

  const insights = [];

  // 1) find the strongest bilateral flow
  let maxAbs = 0;
  let maxRow = null;
  let maxVal = 0;
  filteredData.forEach(d => {
    const flowValue = getFlowValue(d, year);
    const absValue = Math.abs(flowValue);
    if (absValue > maxAbs) {
      maxAbs = absValue;
      maxRow = d;
      maxVal = flowValue;
    }
  });
  if (maxRow) {
    const fromCountry = esc(maxRow.base_country_name);
    const toCountry = esc(maxRow.target_country_name);
    const formatted = maxVal.toFixed(2);
    insights.push(
      `Strongest flow: <strong>${fromCountry} \u2192 ${toCountry}</strong> at ${formatted} per 10K`
    );
  }

  // 2) find the top destination country
  const destGrouped = d3.rollups(
    filteredData,
    rows => d3.sum(rows, d => getFlowValue(d, year)),
    d => d.target_country_name
  );
  const destSorted = destGrouped.sort((a, b) => d3.descending(a[1], b[1]));

  if (destSorted.length > 0 && destSorted[0][1] > 0) {
    const topDestName = esc(destSorted[0][0]);
    const topDestTotal = destSorted[0][1].toFixed(2);
    insights.push(
      `Top destination: <strong>${topDestName}</strong> (${topDestTotal} per 10K total inflow)`
    );
  }

  // 3) find the peak migration year across all years (not just selected)
  const subset = state.rawData.filter(d => {
    // match the country filter
    let countryOk = false;
    if (state.selectedCountry === 'all') {
      countryOk = true;
    } else if (d.base_country_name === state.selectedCountry) {
      countryOk = true;
    } else if (d.target_country_name === state.selectedCountry) {
      countryOk = true;
    }

    // match the income cell filter (if any)
    let incomeOk = true;
    if (state.selectedIncomeCell) {
      const sameOrigin = d.base_country_wb_income === state.selectedIncomeCell.origin;
      const sameDest = d.target_country_wb_income === state.selectedIncomeCell.dest;
      incomeOk = sameOrigin && sameDest;
    }

    return countryOk && incomeOk;
  });

  if (subset.length > 0) {
    // compute total absolute flow for each year
    const totalsByYear = YEARS.map(yr => {
      const yearTotal = d3.sum(subset, d => Math.abs(getFlowValue(d, yr)));
      return { year: yr, total: yearTotal };
    });

    // find which year had the highest total
    let peak = totalsByYear[0];
    for (let i = 1; i < totalsByYear.length; i++) {
      if (totalsByYear[i].total > peak.total) {
        peak = totalsByYear[i];
      }
    }

    if (peak.year === year) {
      insights.push(`${year} is the <strong>peak year</strong> for flow volume in this selection`);
    } else {
      insights.push(`Flow volume peaked in <strong>${peak.year}</strong> for this selection`);
    }
  }

  // 4) either the dominant income pathway, or share-of-total when a cell is selected
  if (!state.selectedIncomeCell) {
    // find which income pair has the highest absolute flow
    const pairGrouped = d3.rollups(
      filteredData,
      rows => d3.sum(rows, d => Math.abs(getFlowValue(d, year))),
      d => `${d.base_country_wb_income}|||${d.target_country_wb_income}`
    );
    const pairSorted = pairGrouped.sort((a, b) => d3.descending(a[1], b[1]));

    if (pairSorted.length > 0) {
      const topPairKey = pairSorted[0][0];
      const parts = topPairKey.split('|||');
      const originName = parts[0];
      const destName = parts[1];
      const originLabel = esc(INCOME_SHORT[originName] || originName);
      const destLabel = esc(INCOME_SHORT[destName] || destName);
      insights.push(
        `Dominant pathway: <strong>${originLabel} \u2192 ${destLabel}</strong> income countries`
      );
    }
  } else {
    // show what percentage of total flow this income pair accounts for
    const countryFiltered = state.rawData.filter(d => {
      if (state.selectedCountry === 'all') return true;
      if (d.base_country_name === state.selectedCountry) return true;
      if (d.target_country_name === state.selectedCountry) return true;
      return false;
    });
    const totalAll = d3.sum(countryFiltered, d => Math.abs(getFlowValue(d, year)));

    if (totalAll > 0) {
      const totalSelected = d3.sum(filteredData, d => Math.abs(getFlowValue(d, year)));
      const percentage = ((totalSelected / totalAll) * 100).toFixed(1);
      insights.push(
        `This income pathway accounts for <strong>${percentage}%</strong> of total flow volume`
      );
    }
  }

  // render the insight bullets as list items
  const listHtml = insights.map(text => `<li class="insight-item">${text}</li>`);
  container.innerHTML = listHtml.join('');
}
