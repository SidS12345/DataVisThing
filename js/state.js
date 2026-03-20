export const state = {
  rawData: [],
  filteredData: [],
  years: [2015, 2016, 2017, 2018, 2019],
  selectedYear: 2019,
  selectedCountry: "all",
  positiveOnly: false,
  selectedTarget: null,
  selectedMapCountry: null,
  selectedIncomeCell: null,  // { origin: "Low Income", dest: "High Income" } or null
  mapTopN: 20               // max flow lines to show on the map
};