export function yearKey(year) {
  return `net_per_10K_${year}`;
}

export function getFlowValue(row, year) {
  const value = +row[yearKey(year)];
  return Number.isFinite(value) ? value : 0;
}

export function filterData(data, state) {
  return data.filter(d => {
    const flow = getFlowValue(d, state.selectedYear);

    const matchesCountry =
      state.selectedCountry === "all" ||
      d.base_country_name === state.selectedCountry ||
      d.target_country_name === state.selectedCountry;

    const matchesPositive = !state.positiveOnly || flow > 0;

    const matchesIncome = !state.selectedIncomeCell ||
      (d.base_country_wb_income === state.selectedIncomeCell.origin &&
       d.target_country_wb_income === state.selectedIncomeCell.dest);

    return matchesCountry && matchesPositive && matchesIncome;
  });
}

export function groupTopDestinations(data, year, topN = 10) {
  const rolled = d3.rollups(
    data,
    rows => d3.sum(rows, d => getFlowValue(d, year)),
    d => d.target_country_name
  )
  .map(([country, total]) => ({ country, total }))
  .sort((a, b) => d3.descending(a.total, b.total))
  .slice(0, topN);

  return rolled;
}

export function yearlyTotals(data, years) {
  return years.map(year => ({
    year,
    total: d3.sum(data, d => getFlowValue(d, year))
  }));
}