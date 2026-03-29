// utils.js
// Shared helper functions and constants used across all view files.
// This includes data filtering, aggregation, tooltip management,
// and the income-level labels that multiple charts need.

export const INCOME_ORDER = [
  'Low Income',
  'Lower Middle Income',
  'Upper Middle Income',
  'High Income'
];

// shorter labels for display (axis ticks, tooltips, etc.)
export const INCOME_SHORT = {
  'Low Income': 'Low',
  'Lower Middle Income': 'Lower middle',
  'Upper Middle Income': 'Upper middle',
  'High Income': 'High'
};

export const YEARS = [2015, 2016, 2017, 2018, 2019];

// builds the column name used in the CSV for a given year
export function yearKey(yr) {
  return `net_per_10K_${yr}`;
}

// safely reads the net flow value for a row and year, defaulting to 0
export function getFlowValue(row, yr) {
  const colName = yearKey(yr);
  const rawValue = +row[colName];
  if (Number.isFinite(rawValue)) {
    return rawValue;
  }
  return 0;
}

// filters the raw CSV rows based on the current dashboard state
// (selected country, positive-only toggle, selected income cell)
export function filterData(data, state) {
  return data.filter(d => {
    const flow = getFlowValue(d, state.selectedYear);

    // does this row match the country filter?
    let countryOk = false;
    if (state.selectedCountry === 'all') {
      countryOk = true;
    } else if (d.base_country_name === state.selectedCountry) {
      countryOk = true;
    } else if (d.target_country_name === state.selectedCountry) {
      countryOk = true;
    }

    // does this row pass the positive-only filter?
    let positiveOk = true;
    if (state.positiveOnly && flow <= 0) {
      positiveOk = false;
    }

    // does this row match the selected income cell (if any)?
    let incomeOk = true;
    if (state.selectedIncomeCell) {
      const sameOrigin = d.base_country_wb_income === state.selectedIncomeCell.origin;
      const sameDest = d.target_country_wb_income === state.selectedIncomeCell.dest;
      incomeOk = sameOrigin && sameDest;
    }

    return countryOk && positiveOk && incomeOk;
  });
}

// aggregates the top N destination countries by total inbound flow
export function groupTopDestinations(data, yr, n = 10) {
  // first, group by destination country and sum the flows
  const grouped = d3.rollups(
    data,
    rows => d3.sum(rows, d => getFlowValue(d, yr)),
    d => d.target_country_name
  );

  // turn the [key, value] pairs into objects
  const asObjects = grouped.map(([country, total]) => ({ country, total }));

  // sort descending by total flow
  const sorted = asObjects.sort((a, b) => d3.descending(a.total, b.total));

  // take only the top N
  const topN = sorted.slice(0, n);

  return topN;
}

// computes total flow for each year (used by insights)
export function yearlyTotals(data, years) {
  return years.map(yr => ({
    year: yr,
    total: d3.sum(data, d => getFlowValue(d, yr))
  }));
}


// --- shared tooltip used by all views ---

const tooltip = d3.select('#tooltip');

export function showTooltip(event, html) {
  const leftPos = event.pageX + 12;
  const topPos = event.pageY + 12;
  tooltip.classed('hidden', false)
    .html(html)
    .style('left', leftPos + 'px')
    .style('top', topPos + 'px');
}

export function moveTooltip(event) {
  const leftPos = event.pageX + 12;
  const topPos = event.pageY + 12;
  tooltip
    .style('left', leftPos + 'px')
    .style('top', topPos + 'px');
}

export function hideTooltip() {
  tooltip.classed('hidden', true);
}
