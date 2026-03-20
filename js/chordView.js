import { getFlowValue } from "./utils.js";

export function createChordView(svgSelector, state, tooltip) {
  const svg = d3.select(svgSelector);

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
    const bounds = svg.node().getBoundingClientRect();
    const width = bounds.width || 600;
    const height = bounds.height || 550;
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const year = state.selectedYear;

    // Aggregate flows by region pair
    const pairMap = new Map();
    const regionSet = new Set();

    data.forEach(d => {
      const v = Math.abs(getFlowValue(d, year));
      if (v === 0) return;
      const base = d.base_country_wb_region;
      const target = d.target_country_wb_region;
      if (!base || !target) return;
      regionSet.add(base);
      regionSet.add(target);
      const key = `${base}|||${target}`;
      pairMap.set(key, (pairMap.get(key) || 0) + v);
    });

    const regions = Array.from(regionSet).sort();
    const n = regions.length;
    if (n === 0) {
      svg.selectAll("*").remove();
      return;
    }

    const indexMap = new Map(regions.map((r, i) => [r, i]));

    // Build matrix
    const matrix = Array.from({ length: n }, () => new Float64Array(n));
    pairMap.forEach((val, key) => {
      const [base, target] = key.split("|||");
      const i = indexMap.get(base);
      const j = indexMap.get(target);
      if (i !== undefined && j !== undefined) {
        matrix[i][j] += val;
      }
    });

    // D3 chord layout
    const chord = d3.chord()
      .padAngle(0.04)
      .sortSubgroups(d3.descending);

    const chords = chord(matrix);

    const outerRadius = Math.min(width, height) * 0.42;
    const innerRadius = outerRadius - 20;

    const arc = d3.arc().innerRadius(innerRadius).outerRadius(outerRadius);
    const ribbon = d3.ribbon().radius(innerRadius);

    const regionColors = [
      "#4e79a7", "#f28e2b", "#e15759", "#76b7b2",
      "#59a14f", "#edc948", "#b07aa1", "#ff9da7",
      "#9c755f", "#bab0ac"
    ];
    const color = d3.scaleOrdinal()
      .domain(d3.range(n))
      .range(regionColors);

    // Clear and draw
    svg.selectAll("*").remove();
    const g = svg.append("g")
      .attr("transform", `translate(${width / 2}, ${height / 2})`);

    // Outer arcs (country groups)
    const groupG = g.selectAll("g.group")
      .data(chords.groups)
      .join("g")
      .attr("class", "group");

    groupG.append("path")
      .attr("d", arc)
      .attr("fill", d => color(d.index))
      .attr("stroke", "#fff")
      .attr("stroke-width", 1)
      .on("mouseover", function(event, d) {
        // Fade ribbons not connected to this group
        g.selectAll(".chord-ribbon")
          .transition().duration(150)
          .style("opacity", r =>
            r.source.index === d.index || r.target.index === d.index ? 0.85 : 0.08
          );
        showTooltip(event, `<strong>${regions[d.index]}</strong>`);
      })
      .on("mousemove", function(event) {
        tooltip
          .style("left", `${event.pageX + 12}px`)
          .style("top", `${event.pageY + 12}px`);
      })
      .on("mouseout", function() {
        g.selectAll(".chord-ribbon")
          .transition().duration(150)
          .style("opacity", 0.65);
        hideTooltip();
      });

    // Country labels
    groupG.append("text")
      .each(d => { d.angle = (d.startAngle + d.endAngle) / 2; })
      .attr("dy", "0.35em")
      .attr("transform", d =>
        `rotate(${(d.angle * 180 / Math.PI - 90)})` +
        `translate(${outerRadius + 8})` +
        (d.angle > Math.PI ? "rotate(180)" : "")
      )
      .attr("text-anchor", d => d.angle > Math.PI ? "end" : "start")
      .attr("font-size", "11px")
      .attr("fill", "#333")
      .text(d => regions[d.index]);

    // Ribbons (flows)
    g.selectAll(".chord-ribbon")
      .data(chords)
      .join("path")
      .attr("class", "chord-ribbon")
      .attr("d", ribbon)
      .attr("fill", d => color(d.source.index))
      .attr("stroke", "none")
      .style("opacity", 0.65)
      .on("mouseover", function(event, d) {
        d3.select(this).transition().duration(150).style("opacity", 0.9);
        const from = regions[d.source.index];
        const to = regions[d.target.index];
        showTooltip(event, `
          <strong>${from} \u2194 ${to}</strong><br/>
          ${d.source.value.toFixed(2)} per 10K
        `);
      })
      .on("mousemove", function(event) {
        tooltip
          .style("left", `${event.pageX + 12}px`)
          .style("top", `${event.pageY + 12}px`);
      })
      .on("mouseout", function() {
        d3.select(this).transition().duration(150).style("opacity", 0.65);
        hideTooltip();
      });
  }

  return { update };
}
