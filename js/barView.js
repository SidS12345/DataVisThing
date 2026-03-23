import { groupTopDestinations } from "./utils.js";

export function createBarView(svgSelector, state, tooltip) {
  const svg = d3.select(svgSelector)
    .attr("preserveAspectRatio", "xMidYMid meet");
  const margin = { top: 20, right: 20, bottom: 44, left: 140 };
  const g = svg.append("g");

  let cachedW = 0, cachedH = 0;
  let lastIncomeMap = new Map();

  function ensureLayout() {
    if (cachedW) return;
    const parent = svg.node().parentNode;
    cachedW = (parent.clientWidth - 32) || 400;
    cachedH = svg.node().getBoundingClientRect().height || 400;
    svg.attr("viewBox", `0 0 ${cachedW} ${cachedH}`);
  }

  window.addEventListener("resize", () => { cachedW = 0; cachedH = 0; });

  function showTooltip(event, html) {
    tooltip.classed("hidden", false).html(html)
      .style("left", `${event.pageX + 12}px`)
      .style("top", `${event.pageY + 12}px`);
  }

  function hideTooltip() { tooltip.classed("hidden", true); }

  function update(data) {
    ensureLayout();

    const innerWidth = cachedW - margin.left - margin.right;
    const innerHeight = cachedH - margin.top - margin.bottom;

    g.attr("transform", `translate(${margin.left},${margin.top})`);
    g.selectAll("*").remove();

    const chartData = groupTopDestinations(data, state.selectedYear, 10);

    // Build country → income lookup for cross-view highlighting
    const incomeMap = new Map();
    data.forEach(d => {
      if (!incomeMap.has(d.base_country_name)) incomeMap.set(d.base_country_name, d.base_country_wb_income);
      if (!incomeMap.has(d.target_country_name)) incomeMap.set(d.target_country_name, d.target_country_wb_income);
    });
    lastIncomeMap = incomeMap;

    const x = d3.scaleLinear()
      .domain([0, d3.max(chartData, d => d.total) || 1])
      .nice()
      .range([0, innerWidth]);

    const y = d3.scaleBand()
      .domain(chartData.map(d => d.country))
      .range([0, innerHeight])
      .padding(0.15);

    g.append("g").call(d3.axisLeft(y));

    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(5));

    const bars = g.selectAll(".bar")
      .data(chartData, d => d.country)
      .join("rect")
      .attr("class", "bar")
      .attr("x", 0)
      .attr("y", d => y(d.country))
      .attr("width", 0)
      .attr("height", y.bandwidth())
      .on("mouseover", function(event, d) {
        d3.select(this).classed("active", true);
        showTooltip(event, `<strong>${d.country}</strong><br/>Total: ${d.total.toFixed(2)} per 10K`);
        state.hover = { type: "country", name: d.country, income: lastIncomeMap.get(d.country) };
        if (state.onHighlight) state.onHighlight();
      })
      .on("mousemove", function(event) {
        tooltip.style("left", `${event.pageX + 12}px`).style("top", `${event.pageY + 12}px`);
      })
      .on("mouseout", function() {
        d3.select(this).classed("active", false);
        hideTooltip();
        state.hover = null;
        if (state.onHighlight) state.onHighlight();
      });

    bars.transition().duration(400)
      .delay((_d, i) => i * 30)
      .attr("width", d => x(d.total));

    g.append("text")
      .attr("class", "axis-label")
      .attr("x", innerWidth / 2)
      .attr("y", innerHeight + 36)
      .attr("text-anchor", "middle")
      .text("Total migration flow (per 10K)");
  }

  function highlight() {
    const h = state.hover;
    g.selectAll(".bar")
      .transition("highlight").duration(150)
      .style("opacity", d => {
        if (!h) return 1;
        if (h.type === "country") return d.country === h.name ? 1 : 0.15;
        if (h.type === "flow") return d.country === h.target ? 1 : 0.15;
        return 1;
      });
  }

  return { update, highlight };
}
