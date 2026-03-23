import { getFlowValue } from "./utils.js";

const YEARS = [2015, 2016, 2017, 2018, 2019];

const INCOME_SHORT = {
  "Low Income":          "Low",
  "Lower Middle Income": "Lower middle",
  "Upper Middle Income": "Upper middle",
  "High Income":         "High"
};

// ─── Exported factory ────────────────────────────────────────────────────────

export function createLineView(svgSelector, state, tooltip) {
  const svg = d3.select(svgSelector)
    .attr("preserveAspectRatio", "xMidYMid meet");

  // Extra right margin to accommodate the legend
  const margin = { top: 24, right: 210, bottom: 52, left: 76 };
  const g = svg.append("g");

  // Layout is cached and invalidated on resize (same pattern as other views)
  let cachedW = 0, cachedH = 0;

  function ensureLayout() {
    if (cachedW) return;
    const parent = svg.node().parentNode;
    cachedW = (parent.clientWidth - 32) || 800;
    cachedH = svg.node().getBoundingClientRect().height || 280;
    svg.attr("viewBox", `0 0 ${cachedW} ${cachedH}`);
  }

  window.addEventListener("resize", () => { cachedW = 0; cachedH = 0; });

  function showTooltip(event, html) {
    tooltip.classed("hidden", false).html(html)
      .style("left", `${event.pageX + 12}px`)
      .style("top",  `${event.pageY + 12}px`);
  }
  function hideTooltip() { tooltip.classed("hidden", true); }

  // ─── Series builder ─────────────────────────────────────────────────────────
  // Returns an array of { key, label, color, values: [{year, value}] }.
  // Uses rawData directly so every year is always present regardless of the
  // selectedYear filter used by the rest of the dashboard.

  function buildSeries(rawData) {
    const { selectedCountry, selectedIncomeCell } = state;

    // Mode 1 — a specific country is selected: show inbound vs outbound trends
    if (selectedCountry !== "all") {
      const country = selectedCountry;

      const inbound = YEARS.map(year => ({
        year,
        value: d3.sum(
          rawData.filter(d => d.target_country_name === country),
          d => Math.max(0, getFlowValue(d, year))
        )
      }));

      const outbound = YEARS.map(year => ({
        year,
        // Magnitude of negative flows leaving the country (base = country, value < 0)
        value: d3.sum(
          rawData.filter(d => d.base_country_name === country),
          d => Math.abs(Math.min(0, getFlowValue(d, year)))
        )
      }));

      return [
        { key: "inbound",  label: `Inbound to ${country}`,   color: "#2563eb", values: inbound  },
        { key: "outbound", label: `Outbound from ${country}`, color: "#ef4444", values: outbound }
      ];
    }

    // Mode 2 — an income-pair cell is selected: trend for that specific pair
    if (selectedIncomeCell) {
      const { origin, dest } = selectedIncomeCell;
      const subset = rawData.filter(
        d => d.base_country_wb_income === origin &&
             d.target_country_wb_income === dest
      );
      const values = YEARS.map(year => ({
        year,
        value: d3.sum(subset, d => getFlowValue(d, year))
      }));
      const shortOrigin = INCOME_SHORT[origin] || origin;
      const shortDest   = INCOME_SHORT[dest]   || dest;
      return [
        {
          key:    "income-pair",
          label:  `${shortOrigin} \u2192 ${shortDest}`,
          color:  "#2563eb",
          values
        }
      ];
    }

    // Mode 3 — default: aggregate net flow across all country pairs
    const values = YEARS.map(year => ({
      year,
      value: d3.sum(rawData, d => getFlowValue(d, year))
    }));
    return [
      { key: "total", label: "All country pairs", color: "#2563eb", values }
    ];
  }

  // ─── Context label (small subtitle below the panel heading) ─────────────────
  function updateContextLabel() {
    const el = document.getElementById("lineViewContext");
    if (!el) return;
    const { selectedCountry, selectedIncomeCell } = state;
    if (selectedCountry !== "all") {
      el.textContent = `Showing inbound and outbound flows for ${selectedCountry}`;
    } else if (selectedIncomeCell) {
      const s = INCOME_SHORT[selectedIncomeCell.origin] || selectedIncomeCell.origin;
      const d = INCOME_SHORT[selectedIncomeCell.dest]   || selectedIncomeCell.dest;
      el.textContent = `Showing: ${s} \u2192 ${d} income pair`;
    } else {
      el.textContent = "Showing: aggregate across all country pairs";
    }
  }

  // ─── Main update ─────────────────────────────────────────────────────────────
  function update(rawData) {
    ensureLayout();

    const innerW = cachedW - margin.left - margin.right;
    const innerH = cachedH - margin.top  - margin.bottom;

    g.attr("transform", `translate(${margin.left},${margin.top})`);
    g.selectAll("*").remove();

    const series = buildSeries(rawData);
    updateContextLabel();

    // ── Scales ──────────────────────────────────────────────────────────────
    const allValues = series.flatMap(s => s.values.map(v => v.value));
    const yMin = Math.min(0, d3.min(allValues) ?? 0);
    const yMax = d3.max(allValues) ?? 1;

    const x = d3.scalePoint()
      .domain(YEARS)
      .range([0, innerW])
      .padding(0.3);

    const y = d3.scaleLinear()
      .domain([yMin, yMax])
      .nice()
      .range([innerH, 0]);

    // ── Gridlines ────────────────────────────────────────────────────────────
    g.append("g")
      .attr("class", "line-grid")
      .call(
        d3.axisLeft(y).ticks(5)
          .tickSize(-innerW)
          .tickFormat("")
      )
      .call(gg => gg.select(".domain").remove())
      .call(gg => gg.selectAll(".tick line")
        .attr("stroke", "#e5e7eb")
        .attr("stroke-dasharray", "3,3")
      );

    // Zero baseline (visible when data goes negative)
    if (yMin < 0) {
      g.append("line")
        .attr("class", "zero-line")
        .attr("x1", 0).attr("x2", innerW)
        .attr("y1", y(0)).attr("y2", y(0))
        .attr("stroke", "#9ca3af")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "4,2");
    }

    // ── Axes ─────────────────────────────────────────────────────────────────
    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .call(d3.axisBottom(x).tickFormat(d3.format("d")));

    g.append("g")
      .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".1f")));

    // Axis labels
    g.append("text")
      .attr("class", "axis-label")
      .attr("x", innerW / 2)
      .attr("y", innerH + 44)
      .attr("text-anchor", "middle")
      .text("Year");

    g.append("text")
      .attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -innerH / 2)
      .attr("y", -62)
      .attr("text-anchor", "middle")
      .text("Net migration flow (per 10K)");

    // ── Lines and dots ────────────────────────────────────────────────────────
    const line = d3.line()
      .x(d => x(d.year))
      .y(d => y(d.value))
      .curve(d3.curveMonotoneX);

    series.forEach(s => {
      // Path
      g.append("path")
        .datum(s.values)
        .attr("fill", "none")
        .attr("stroke", s.color)
        .attr("stroke-width", 2.5)
        .attr("stroke-linejoin", "round")
        .attr("d", line);

      // Dots (separate selection so each series' key is unique)
      g.selectAll(`.lv-dot-${s.key}`)
        .data(s.values)
        .join("circle")
        .attr("class", `lv-dot lv-dot-${s.key}`)
        .attr("cx", d => x(d.year))
        .attr("cy", d => y(d.value))
        .attr("r", 5)
        .attr("fill", s.color)
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.5)
        .on("mouseover", function(event, d) {
          d3.select(this).attr("r", 7);
          showTooltip(event, `
            <strong>${s.label}</strong><br/>
            ${d.year}: ${d3.format("+.2f")(d.value)} per 10K
          `);
        })
        .on("mousemove", function(event) {
          tooltip.style("left", `${event.pageX + 12}px`)
                 .style("top",  `${event.pageY + 12}px`);
        })
        .on("mouseout", function() {
          d3.select(this).attr("r", 5);
          hideTooltip();
        });
    });

    // ── Legend ────────────────────────────────────────────────────────────────
    const legendX = innerW + 20;
    const legendG = g.append("g").attr("class", "lv-legend");

    series.forEach((s, i) => {
      const row = legendG.append("g")
        .attr("transform", `translate(${legendX},${i * 26})`);

      row.append("line")
        .attr("x1", 0).attr("x2", 20)
        .attr("y1", 8).attr("y2", 8)
        .attr("stroke", s.color)
        .attr("stroke-width", 2.5);

      row.append("circle")
        .attr("cx", 10).attr("cy", 8).attr("r", 4)
        .attr("fill", s.color)
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.5);

      row.append("text")
        .attr("x", 26)
        .attr("y", 12)
        .attr("font-size", "11px")
        .attr("fill", "#374151")
        .text(s.label);
    });
  }

  return { update };
}
