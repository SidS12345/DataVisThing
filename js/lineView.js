import { yearlyTotals } from "./utils.js";

export function createLineView(svgSelector, state, tooltip) {
  const svg = d3.select(svgSelector);
  const margin = { top: 20, right: 20, bottom: 40, left: 60 };
  const g = svg.append("g");

  function resize() {
    const bounds = svg.node().getBoundingClientRect();
    svg.attr("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
  }

  function showTooltip(event, html) {
    tooltip
      .classed("hidden", false)
      .html(html)
      .style("left", `${event.pageX + 12}px`)
      .style("top", `${event.pageY + 12}px`);
  }

  function hideTooltip() {
    tooltip.classed("hidden", true);
  }

  function update(data) {
    resize();

    const { width, height } = svg.node().getBoundingClientRect();
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    g.attr("transform", `translate(${margin.left},${margin.top})`);
    g.selectAll("*").remove();

    const chartData = yearlyTotals(data, state.years);

    const x = d3.scalePoint()
      .domain(chartData.map(d => d.year))
      .range([0, innerWidth]);

    const y = d3.scaleLinear()
      .domain([0, d3.max(chartData, d => d.total) || 1])
      .nice()
      .range([innerHeight, 0]);

    const line = d3.line()
      .x(d => x(d.year))
      .y(d => y(d.total));

    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x));

    g.append("g")
      .call(d3.axisLeft(y).ticks(5));

    g.append("path")
      .datum(chartData)
      .attr("class", "line-path")
      .attr("d", line);

    g.selectAll(".point")
      .data(chartData)
      .join("circle")
      .attr("class", "point")
      .attr("r", 4)
      .attr("cx", d => x(d.year))
      .attr("cy", d => y(d.total))
      .on("mouseover", function(event, d) {
        showTooltip(event, `
          <strong>${d.year}</strong><br/>
          Total: ${d.total.toFixed(2)}
        `);
      })
      .on("mousemove", function(event) {
        tooltip
          .style("left", `${event.pageX + 12}px`)
          .style("top", `${event.pageY + 12}px`);
      })
      .on("mouseout", hideTooltip);

    g.append("text")
      .attr("class", "axis-label")
      .attr("x", innerWidth / 2)
      .attr("y", innerHeight + 34)
      .attr("text-anchor", "middle")
      .text("Year");
  }

  window.addEventListener("resize", resize);

  return { update };
}