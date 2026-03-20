import { getFlowValue } from "./utils.js";

const INCOME_ORDER = [
  "Low Income",
  "Lower Middle Income",
  "Upper Middle Income",
  "High Income"
];

const INCOME_SHORT = {
  "Low Income": "Low",
  "Lower Middle Income": "Lower middle",
  "Upper Middle Income": "Upper middle",
  "High Income": "High"
};

export function createHeatmapView(svgSelector, state, tooltip, onCellClick) {
  const svg = d3.select(svgSelector)
    .attr("preserveAspectRatio", "xMidYMin meet");

  // ─── Stable layout: measured once, cached ───────────────────
  let cachedLayout = null;

  function ensureLayout() {
    if (cachedLayout) return cachedLayout;

    const parent = svg.node().parentNode;
    const width = (parent.clientWidth - 32) || 600;   // subtract panel padding
    const height = Math.max(svg.node().getBoundingClientRect().height, 380);
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const margin = { top: 28, right: 100, bottom: 60, left: 120 };
    const gridW = width - margin.left - margin.right;
    const gridH = height - margin.top - margin.bottom;

    cachedLayout = { width, height, margin, gridW, gridH, cellW: gridW / 4, cellH: gridH / 4 };
    return cachedLayout;
  }

  window.addEventListener("resize", () => { cachedLayout = null; });

  // ─── Persistent SVG structure (created once) ────────────────
  const defs = svg.append("defs");
  const rootG = svg.append("g");

  function showTooltip(event, html) {
    tooltip.classed("hidden", false).html(html)
      .style("left", `${event.pageX + 12}px`)
      .style("top", `${event.pageY + 12}px`);
  }

  function hideTooltip() { tooltip.classed("hidden", true); }

  // ─── Update (data only, no layout recomputation) ────────────
  function update(data) {
    const L = ensureLayout();
    const { margin, gridW, gridH, cellW, cellH } = L;

    rootG.attr("transform", `translate(${margin.left}, ${margin.top})`);

    const year = state.selectedYear;

    // Aggregate by income pair (ignoring income cell selection so heatmap always shows full picture)
    const allData = state.rawData.filter(d => {
      const flow = getFlowValue(d, state.selectedYear);
      const matchesCountry =
        state.selectedCountry === "all" ||
        d.base_country_name === state.selectedCountry ||
        d.target_country_name === state.selectedCountry;
      const matchesPositive = !state.positiveOnly || flow > 0;
      return matchesCountry && matchesPositive;
    });

    const cellMap = new Map();
    let totalFlow = 0;
    INCOME_ORDER.forEach(o => {
      INCOME_ORDER.forEach(d => { cellMap.set(`${o}|||${d}`, 0); });
    });

    allData.forEach(d => {
      const v = getFlowValue(d, year);
      const key = `${d.base_country_wb_income}|||${d.target_country_wb_income}`;
      if (cellMap.has(key)) {
        cellMap.set(key, cellMap.get(key) + v);
        totalFlow += v;
      }
    });

    const cells = [];
    INCOME_ORDER.forEach((origin, ri) => {
      INCOME_ORDER.forEach((dest, ci) => {
        cells.push({ origin, dest, value: cellMap.get(`${origin}|||${dest}`), row: ri, col: ci });
      });
    });

    const absMax = d3.max(cells, d => Math.abs(d.value)) || 1;
    const colorScale = d3.scaleDiverging()
      .domain([-absMax, 0, absMax])
      .interpolator(d3.interpolateRdBu);

    const sel = state.selectedIncomeCell;

    // --- Cells ---
    rootG.selectAll("rect.hm-cell")
      .data(cells, d => `${d.row}-${d.col}`)
      .join("rect")
      .attr("class", "hm-cell")
      .attr("x", d => d.col * cellW)
      .attr("y", d => d.row * cellH)
      .attr("width", cellW - 2)
      .attr("height", cellH - 2)
      .attr("rx", 4)
      .attr("fill", d => colorScale(d.value))
      .attr("stroke", d =>
        sel && sel.origin === d.origin && sel.dest === d.dest ? "#1f2937" : "none"
      )
      .attr("stroke-width", d =>
        sel && sel.origin === d.origin && sel.dest === d.dest ? 3 : 0
      )
      .style("opacity", d => {
        if (!sel) return 1;
        return (sel.origin === d.origin && sel.dest === d.dest) ? 1 : 0.35;
      })
      .style("cursor", "pointer")
      .on("mouseover", function(event, d) {
        d3.select(this).attr("stroke", "#1f2937").attr("stroke-width", 2);
        const pct = totalFlow !== 0 ? ((d.value / totalFlow) * 100).toFixed(1) : "0.0";
        showTooltip(event, `
          <strong>${INCOME_SHORT[d.origin]} \u2192 ${INCOME_SHORT[d.dest]}</strong><br/>
          Net flow: ${d.value.toFixed(2)} per 10K<br/>
          Share of total: ${pct}%
        `);
      })
      .on("mousemove", function(event) {
        tooltip.style("left", `${event.pageX + 12}px`).style("top", `${event.pageY + 12}px`);
      })
      .on("mouseout", function(event, d) {
        const isSelected = sel && sel.origin === d.origin && sel.dest === d.dest;
        d3.select(this)
          .attr("stroke", isSelected ? "#1f2937" : "none")
          .attr("stroke-width", isSelected ? 3 : 0);
        hideTooltip();
      })
      .on("click", function(event, d) {
        if (onCellClick) onCellClick(d.origin, d.dest);
      });

    // --- Cell value labels ---
    rootG.selectAll("text.hm-value")
      .data(cells, d => `${d.row}-${d.col}`)
      .join("text")
      .attr("class", "hm-value")
      .attr("x", d => d.col * cellW + (cellW - 2) / 2)
      .attr("y", d => d.row * cellH + (cellH - 2) / 2)
      .attr("dy", "0.35em")
      .attr("text-anchor", "middle")
      .attr("font-size", "13px")
      .attr("font-weight", 600)
      .attr("fill", d => Math.abs(d.value) > absMax * 0.6 ? "#fff" : "#1f2937")
      .style("pointer-events", "none")
      .text(d => d.value.toFixed(1));

    // --- Axis labels (static structure, always 4 items — join handles idempotently) ---
    rootG.selectAll("text.hm-y-label")
      .data(INCOME_ORDER)
      .join("text")
      .attr("class", "hm-y-label")
      .attr("x", -10)
      .attr("y", (d, i) => i * cellH + cellH / 2)
      .attr("dy", "0.35em")
      .attr("text-anchor", "end")
      .attr("font-size", "12px")
      .attr("fill", "#1f2937")
      .text(d => INCOME_SHORT[d]);

    rootG.selectAll("text.hm-y-title")
      .data(["Origin income level"])
      .join("text")
      .attr("class", "hm-y-title")
      .attr("transform", "rotate(-90)")
      .attr("x", -gridH / 2)
      .attr("y", -margin.left + 16)
      .attr("text-anchor", "middle")
      .attr("font-size", "13px")
      .attr("font-weight", 600)
      .attr("fill", "#6b7280")
      .text(d => d);

    rootG.selectAll("text.hm-x-label")
      .data(INCOME_ORDER)
      .join("text")
      .attr("class", "hm-x-label")
      .attr("x", (d, i) => i * cellW + (cellW - 2) / 2)
      .attr("y", gridH + 16)
      .attr("text-anchor", "middle")
      .attr("font-size", "12px")
      .attr("fill", "#1f2937")
      .text(d => INCOME_SHORT[d]);

    rootG.selectAll("text.hm-x-title")
      .data(["Destination income level"])
      .join("text")
      .attr("class", "hm-x-title")
      .attr("x", gridW / 2)
      .attr("y", gridH + 44)
      .attr("text-anchor", "middle")
      .attr("font-size", "13px")
      .attr("font-weight", 600)
      .attr("fill", "#6b7280")
      .text(d => d);

    // --- Colour legend ---
    const legendW = 16;
    const legendX = gridW + 24;

    // Gradient (update stops in-place)
    const gradId = "hm-legend-grad";
    let grad = defs.select(`#${gradId}`);
    if (grad.empty()) {
      grad = defs.append("linearGradient")
        .attr("id", gradId)
        .attr("x1", "0%").attr("y1", "0%")
        .attr("x2", "0%").attr("y2", "100%");
    }
    const nStops = 10;
    const stops = [];
    for (let i = 0; i <= nStops; i++) {
      const t = i / nStops;
      stops.push({ offset: `${t * 100}%`, color: colorScale(absMax * (1 - 2 * t)) });
    }
    grad.selectAll("stop").data(stops).join("stop")
      .attr("offset", d => d.offset)
      .attr("stop-color", d => d.color);

    // Legend group
    const legendG = rootG.selectAll("g.hm-legend").data([null]).join("g")
      .attr("class", "hm-legend")
      .attr("transform", `translate(${legendX}, 0)`);

    legendG.selectAll("rect.hm-legend-bar").data([null]).join("rect")
      .attr("class", "hm-legend-bar")
      .attr("width", legendW)
      .attr("height", gridH)
      .attr("rx", 3)
      .attr("fill", `url(#${gradId})`);

    const legendScale = d3.scaleLinear().domain([absMax, -absMax]).range([0, gridH]);
    const legendAxis = d3.axisRight(legendScale).ticks(5).tickFormat(d3.format(".1f"));

    let axisG = legendG.selectAll("g.hm-legend-axis").data([null]).join("g")
      .attr("class", "hm-legend-axis")
      .attr("transform", `translate(${legendW}, 0)`);
    axisG.call(legendAxis);
    axisG.select(".domain").remove();
    axisG.selectAll(".tick text").attr("font-size", "10px");

    legendG.selectAll("text.hm-legend-title").data(["per 10K"]).join("text")
      .attr("class", "hm-legend-title")
      .attr("x", legendW / 2)
      .attr("y", -6)
      .attr("text-anchor", "middle")
      .attr("font-size", "10px")
      .attr("fill", "#6b7280")
      .text(d => d);
  }

  return { update };
}
