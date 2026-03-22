import { groupTopDestinations } from "./utils.js";

export function createBarView(svgSelector, state, tooltip) {
  const svg = d3.select(svgSelector)
    .attr("preserveAspectRatio", "xMidYMid meet");
  const margin = { top: 20, right: 20, bottom: 44, left: 140 };
  const g = svg.append("g");

  let cachedW = 0, cachedH = 0;

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

    g.selectAll(".bar")
      .data(chartData, d => d.country)
      .join("rect")
      .attr("class", "bar")
      .attr("x", 0)
      .attr("y", d => y(d.country))
      .attr("width", d => x(d.total))
      .attr("height", y.bandwidth())
      .on("mouseover", function(event, d) {
        d3.select(this).classed("active", true);
        showTooltip(event, `<strong>${d.country}</strong><br/>Total: ${d.total.toFixed(2)}`);
      })
      .on("mousemove", function(event) {
        tooltip.style("left", `${event.pageX + 12}px`).style("top", `${event.pageY + 12}px`);
      })
      .on("mouseout", function() {
        d3.select(this).classed("active", false);
        hideTooltip();
      });

    g.append("text")
      .attr("class", "axis-label")
      .attr("x", innerWidth / 2)
      .attr("y", innerHeight + 36)
      .attr("text-anchor", "middle")
      .text("Total migration flow");
  }

  return { update };
}
