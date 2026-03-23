import { getFlowValue } from "./utils.js";

const INCOME_SHORT = {
  "Low Income":          "Low",
  "Lower Middle Income": "Lower middle",
  "Upper Middle Income": "Upper middle",
  "High Income":         "High"
};

export function createMapView(svgSelector, state, tooltip, onCountryClick) {
  const svg = d3.select(svgSelector)
    .attr("preserveAspectRatio", "xMidYMin meet");
  const bgGroup = svg.append("g").attr("class", "bg-layer");
  const g = svg.append("g").attr("class", "map-layer");
  // Legend layer sits outside the zoom transform so it stays fixed on screen
  const legendGroup = svg.append("g").attr("class", "map-legend-layer");

  // Click empty space to deselect country
  svg.on("click", function() {
    if (state.selectedMapCountry) {
      state.selectedMapCountry = null;
      if (state.filteredData) update(state.filteredData);
    }
  });

  let worldGeo = null;

  // Cached layout — only recomputed when the container size changes
  let cachedW = 0;
  let cachedH = 0;
  let cachedProjection = null;

  d3.json("https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson")
    .then(data => {
      worldGeo = data;
      if (state.filteredData) update(state.filteredData);
    })
    .catch(err => console.error("Failed to load world GeoJSON:", err));

  // Full north, cut off below Antarctica (~58 S keeps Patagonia/NZ)
  const clippedBounds = {
    type: "Polygon",
    coordinates: [[[-180, 84], [180, 84], [180, -58], [-180, -58], [-180, 84]]]
  };

  function makeProjection(w, h) {
    return d3.geoMercator().fitSize([w, h], clippedBounds);
  }

  function proj(projection, lon, lat) {
    return projection([+lon, +lat]);
  }

  function showTooltip(event, html) {
    tooltip.classed("hidden", false).html(html)
      .style("left", `${event.pageX + 12}px`)
      .style("top", `${event.pageY + 12}px`);
  }

  function hideTooltip() { tooltip.classed("hidden", true); }

  // Measure from the SVG's parent so dimensions stay stable after viewBox is set.
  function ensureLayout() {
    if (cachedProjection) return cachedProjection;

    const parent = svg.node().parentNode;
    const w = (parent.clientWidth - 32) || 800;

    const tempProj = d3.geoMercator().fitWidth(w, clippedBounds);
    const topLeft = tempProj([-180, 84]);
    const bottomRight = tempProj([180, -58]);
    const h = Math.ceil(bottomRight[1] - topLeft[1]);

    cachedW = w;
    cachedH = h;
    svg.attr("viewBox", `0 0 ${w} ${h}`);
    svg.style("height", `${h}px`);
    cachedProjection = d3.geoMercator().fitSize([w, h], clippedBounds);
    return cachedProjection;
  }

  let bgDrawn = false;
  function ensureBackground(projection) {
    if (!worldGeo || bgDrawn) return;
    const path = d3.geoPath(projection);
    bgGroup.selectAll("path.country")
      .data(worldGeo.features)
      .join("path")
      .attr("class", "country")
      .attr("d", path)
      .attr("fill", "#f2efe9")
      .attr("stroke", "#d5d2c8")
      .attr("stroke-width", 0.5);
    bgDrawn = true;
  }

  // ─── Filtering pipeline ──────────────────────────────────────
  let lastTotalAvailable = 0;

  function prepareMapFlows(data, year) {
    const sel = state.selectedMapCountry;
    const topN = state.mapTopN || 20;

    let pool = sel
      ? data.filter(d => d.base_country_name === sel || d.target_country_name === sel)
      : data;

    const sorted = pool
      .map(d => ({ d, abs: Math.abs(getFlowValue(d, year)) }))
      .filter(o => o.abs > 0)
      .sort((a, b) => b.abs - a.abs);

    const totalAvailable = sorted.length;
    const showing = Math.min(topN, totalAvailable);

    const label = document.getElementById("mapTopNValue");
    if (label) label.textContent = `${showing} / ${totalAvailable}`;

    if (totalAvailable !== lastTotalAvailable) {
      lastTotalAvailable = totalAvailable;
      const slider = document.getElementById("mapTopNSlider");
      const numInput = document.getElementById("mapTopNInput");
      if (slider) {
        const roundedMax = Math.ceil(totalAvailable / 5) * 5;
        slider.max = Math.max(roundedMax, 5);
        if (+slider.value > totalAvailable) {
          slider.value = roundedMax;
          state.mapTopN = roundedMax;
        }
      }
      if (numInput) numInput.max = totalAvailable;
    }

    return sorted.slice(0, topN).map(o => o.d);
  }

  // ─── Update (data-only; layout is stable) ────────────────────
  function update(data) {
    const projection = ensureLayout();
    ensureBackground(projection);
    const year = state.selectedYear;
    const incSel = state.selectedIncomeCell;

    const mapData = prepareMapFlows(data, year);

    // Status label — show actual income pair names when selected
    const statusEl = document.getElementById("mapStatusLabel");
    if (statusEl) {
      const parts = [];
      if (incSel) {
        parts.push(`${INCOME_SHORT[incSel.origin]} \u2192 ${INCOME_SHORT[incSel.dest]}`);
      }
      if (state.selectedMapCountry) parts.push(state.selectedMapCountry);
      if (state.selectedCountry !== "all") parts.push(state.selectedCountry);
      const context = parts.length ? parts.join(" + ") : "all countries";
      statusEl.textContent = `${mapData.length} flow${mapData.length !== 1 ? "s" : ""} \u2014 ${context}, ${year}`;
    }

    // Scales (relative to visible subset)
    const flowMax = d3.max(mapData, d => Math.abs(getFlowValue(d, year))) || 1;
    const strokeScale = d3.scaleSqrt().domain([0, flowMax]).range([1, 7]);
    const opacityScale = d3.scaleSqrt().domain([0, flowMax]).range([0.25, 0.85]);

    function flowPath(d) {
      const [x1, y1] = proj(projection, d.base_long, d.base_lat);
      const [x2, y2] = proj(projection, d.target_long, d.target_lat);
      const dx = x2 - x1;
      const dy = y2 - y1;
      return `M${x1},${y1} Q${(x1 + x2) / 2 - dy * 0.15},${(y1 + y2) / 2 + dx * 0.15} ${x2},${y2}`;
    }

    function flowClass(d) {
      const v = getFlowValue(d, year);
      return `flow-line ${v >= 0 ? "flow-positive" : "flow-negative"}`;
    }

    // --- Flow arcs (with enter / update / exit transitions) ---
    const flows = g.selectAll(".flow-line")
      .data(mapData, d => `${d.base_country_name}-${d.target_country_name}`)
      .join(
        enter => enter.append("path")
          .attr("class", flowClass)
          .attr("d", flowPath)
          .attr("stroke-width", d => strokeScale(Math.abs(getFlowValue(d, year))))
          .style("stroke-opacity", 0)
          .call(en => en.transition().duration(500)
            .style("stroke-opacity", d => opacityScale(Math.abs(getFlowValue(d, year))))
          ),
        update => update
          .attr("class", flowClass)
          .attr("d", flowPath)
          .call(up => up.transition().duration(500)
            .attr("stroke-width", d => strokeScale(Math.abs(getFlowValue(d, year))))
            .style("stroke-opacity", d => opacityScale(Math.abs(getFlowValue(d, year))))
          ),
        exit => exit
          .call(ex => ex.transition().duration(300)
            .style("stroke-opacity", 0)
            .remove()
          )
      );

    // Re-bind events on all flows so closures capture the current year
    flows
      .on("mouseover", function(event, d) {
        d3.select(this).classed("active", true);
        const v = getFlowValue(d, year);
        const dir = v >= 0 ? "inflow" : "outflow";
        showTooltip(event, `
          <strong>${d.base_country_name} \u2192 ${d.target_country_name}</strong><br/>
          <span style="opacity:0.7">${d.base_country_wb_income} \u2192 ${d.target_country_wb_income}</span><br/>
          ${year}: ${d3.format("+.2f")(v)} per 10K (${dir})
        `);
        state.hover = {
          type: "flow",
          base: d.base_country_name,
          target: d.target_country_name,
          baseIncome: d.base_country_wb_income,
          targetIncome: d.target_country_wb_income
        };
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

    // --- Country nodes (income-pair-aware coloring + transitions) ---
    const nodesMap = new Map();
    const nodeRoles = new Map();

    mapData.forEach(d => {
      if (!nodesMap.has(d.base_country_name)) {
        nodesMap.set(d.base_country_name, {
          name: d.base_country_name, income: d.base_country_wb_income,
          lat: +d.base_lat, lon: +d.base_long
        });
      }
      if (!nodesMap.has(d.target_country_name)) {
        nodesMap.set(d.target_country_name, {
          name: d.target_country_name, income: d.target_country_wb_income,
          lat: +d.target_lat, lon: +d.target_long
        });
      }
      // Track whether each country acts as origin, destination, or both
      if (incSel) {
        if (!nodeRoles.has(d.base_country_name)) nodeRoles.set(d.base_country_name, new Set());
        nodeRoles.get(d.base_country_name).add("origin");
        if (!nodeRoles.has(d.target_country_name)) nodeRoles.set(d.target_country_name, new Set());
        nodeRoles.get(d.target_country_name).add("dest");
      }
    });

    const ORIGIN_COLOR = "#f59e0b";   // amber  — sending countries
    const DEST_COLOR   = "#2563eb";   // blue   — receiving countries
    const BOTH_COLOR   = "#8b5cf6";   // purple — both roles

    function nodeColor(d) {
      if (!incSel) return null;  // null removes inline style, CSS takes over
      const roles = nodeRoles.get(d.name);
      if (!roles) return null;
      if (roles.has("origin") && roles.has("dest")) return BOTH_COLOR;
      if (roles.has("origin")) return ORIGIN_COLOR;
      if (roles.has("dest"))   return DEST_COLOR;
      return null;
    }

    const nodes = Array.from(nodesMap.values());
    const sel = state.selectedMapCountry;

    const nodeSel = g.selectAll(".country-node")
      .data(nodes, d => d.name)
      .join(
        enter => enter.append("circle")
          .attr("class", "country-node")
          .attr("cx", d => proj(projection, d.lon, d.lat)[0])
          .attr("cy", d => proj(projection, d.lon, d.lat)[1])
          .attr("r", 0)
          .call(en => en.transition().duration(400).attr("r", 4)),
        update => update
          .attr("cx", d => proj(projection, d.lon, d.lat)[0])
          .attr("cy", d => proj(projection, d.lon, d.lat)[1]),
        exit => exit
          .call(ex => ex.transition().duration(300).attr("r", 0).remove())
      );

    // Income-aware fill (null removes inline style so CSS default kicks in)
    nodeSel.style("fill", d => nodeColor(d));

    // Re-bind events on enter + update so closures stay current
    nodeSel
      .on("mouseover", function(event, d) {
        d3.select(this).transition().duration(150).attr("r", 7);
        showTooltip(event, `<strong>${d.name}</strong><br/><span style="opacity:0.7">${d.income}</span>`);
        state.hover = { type: "country", name: d.name, income: d.income };
        if (state.onHighlight) state.onHighlight();
      })
      .on("mousemove", function(event) {
        tooltip.style("left", `${event.pageX + 12}px`).style("top", `${event.pageY + 12}px`);
      })
      .on("mouseout", function() {
        d3.select(this).transition().duration(150).attr("r", 4);
        hideTooltip();
        state.hover = null;
        if (state.onHighlight) state.onHighlight();
      })
      .on("click", function(event, d) {
        event.stopPropagation();
        if (onCountryClick) onCountryClick(d.name);
      });

    nodeSel.classed("selected", d => d.name === sel);

    // --- Income-pair map legend (fixed in corner, outside zoom transform) ---
    legendGroup.selectAll("*").remove();
    if (incSel) {
      const so = INCOME_SHORT[incSel.origin] || incSel.origin;
      const sd = INCOME_SHORT[incSel.dest]   || incSel.dest;
      const sameLevel = incSel.origin === incSel.dest;

      const lgH = sameLevel ? 32 : 52;
      const lg = legendGroup.append("g")
        .attr("transform", `translate(16, ${cachedH - lgH - 12})`)
        .style("opacity", 0);

      lg.append("rect")
        .attr("width", 200).attr("height", lgH)
        .attr("rx", 8)
        .attr("fill", "rgba(255,255,255,0.92)")
        .attr("stroke", "#dbe2ea");

      if (sameLevel) {
        lg.append("circle").attr("cx", 14).attr("cy", 16).attr("r", 5).attr("fill", BOTH_COLOR);
        lg.append("text").attr("x", 26).attr("y", 20)
          .attr("font-size", "11px").attr("fill", "#374151")
          .text(`${so} (both roles)`);
      } else {
        lg.append("circle").attr("cx", 14).attr("cy", 16).attr("r", 5).attr("fill", ORIGIN_COLOR);
        lg.append("text").attr("x", 26).attr("y", 20)
          .attr("font-size", "11px").attr("fill", "#374151")
          .text(`Origin: ${so}`);
        lg.append("circle").attr("cx", 14).attr("cy", 36).attr("r", 5).attr("fill", DEST_COLOR);
        lg.append("text").attr("x", 26).attr("y", 40)
          .attr("font-size", "11px").attr("fill", "#374151")
          .text(`Dest: ${sd}`);
      }

      lg.transition().duration(400).style("opacity", 1);
    }

    // --- Flow direction legend (always visible, bottom-right) ---
    const fdLg = legendGroup.append("g")
      .attr("transform", `translate(${cachedW - 156}, ${cachedH - 44})`);

    fdLg.append("rect")
      .attr("width", 144).attr("height", 36)
      .attr("rx", 6)
      .attr("fill", "rgba(255,255,255,0.92)")
      .attr("stroke", "#dbe2ea");

    fdLg.append("line")
      .attr("x1", 10).attr("x2", 32).attr("y1", 12).attr("y2", 12)
      .attr("stroke", "#2563eb").attr("stroke-width", 2.5)
      .attr("stroke-linecap", "round");
    fdLg.append("text").attr("x", 38).attr("y", 16)
      .attr("font-size", "10px").attr("fill", "#374151")
      .text("Inflow (+)");

    fdLg.append("line")
      .attr("x1", 10).attr("x2", 32).attr("y1", 26).attr("y2", 26)
      .attr("stroke", "#ef4444").attr("stroke-width", 2.5)
      .attr("stroke-linecap", "round");
    fdLg.append("text").attr("x", 38).attr("y", 30)
      .attr("font-size", "10px").attr("fill", "#374151")
      .text("Outflow (\u2212)");

    // ── Debug: verify SVG structure stays constant across updates ──
    if (typeof window.__mapUpdateCount === "undefined") window.__mapUpdateCount = 0;
    window.__mapUpdateCount++;
    const _svgChildren = svg.node().childNodes.length;   // should be 3 (bg, map, legend)
    const _flowCount   = g.selectAll(".flow-line").size();
    const _nodeCount   = g.selectAll(".country-node").size();
    const _legendItems = legendGroup.selectAll("g").size();
    console.debug(
      `[mapView] update #${window.__mapUpdateCount}: ` +
      `svgChildren=${_svgChildren} (expect 3), ` +
      `flows=${_flowCount}, nodes=${_nodeCount}, legendGroups=${_legendItems}`
    );
    if (_svgChildren !== 3) {
      console.warn("[mapView] SVG child count !== 3 — possible element leak");
    }
  }

  // ─── Cross-view highlight ──────────────────────────────────────
  // Uses element-level opacity so it stacks on top of existing
  // stroke-opacity without overriding it.
  function highlight() {
    const h = state.hover;

    g.selectAll(".flow-line")
      .transition("highlight").duration(150)
      .style("opacity", d => {
        if (!h) return 1;
        let match = false;
        if (h.type === "country") {
          match = d.base_country_name === h.name || d.target_country_name === h.name;
        } else if (h.type === "incomeCell") {
          match = d.base_country_wb_income === h.origin && d.target_country_wb_income === h.dest;
        } else if (h.type === "flow") {
          match = d.base_country_name === h.base && d.target_country_name === h.target;
        }
        return match ? 1 : 0.08;
      });

    g.selectAll(".country-node")
      .transition("highlight").duration(150)
      .style("opacity", d => {
        if (!h) return 1;
        if (h.type === "country") return d.name === h.name ? 1 : 0.2;
        if (h.type === "flow") return (d.name === h.base || d.name === h.target) ? 1 : 0.2;
        return 1;
      });
  }

  // Invalidate cached layout on window resize so the next update recomputes
  window.addEventListener("resize", () => { cachedProjection = null; bgDrawn = false; });

  return { update, highlight };
}
