import { getFlowValue } from "./utils.js";

export function createMapView(svgSelector, state, tooltip, onCountryClick) {
  const svg = d3.select(svgSelector)
    .attr("preserveAspectRatio", "xMidYMin meet");
  const bgGroup = svg.append("g").attr("class", "bg-layer");
  const g = svg.append("g").attr("class", "map-layer");

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

  function makeProjection(w, h) {
    return d3.geoMercator()
      .scale(w / (2 * Math.PI))
      .translate([w / 2, h / 2]);
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

  // Measure from the SVG's parent (an HTML element with stable dimensions)
  // rather than the SVG itself, whose dimensions become unreliable after
  // a viewBox is set (SVG gains an intrinsic aspect ratio that shifts
  // getBoundingClientRect results on subsequent reads).
  function measureContainer() {
    const svgNode = svg.node();
    // parentNode is the .panel <section> — a normal HTML element
    const parent = svgNode.parentNode;
    // Use offsetWidth/offsetHeight which are layout-stable on HTML elements
    const w = parent.clientWidth - 32 || 800;  // subtract panel padding (16px each side)
    // For height, use the SVG's CSS-resolved height (min-height) before viewBox interferes
    const h = Math.max(svgNode.getBoundingClientRect().height, 600);
    return { w, h };
  }

  // Recompute projection/viewBox only if the cache is empty (first call or after resize).
  function ensureLayout() {
    if (cachedProjection) return cachedProjection;

    const { w, h } = measureContainer();
    cachedW = w;
    cachedH = h;
    svg.attr("viewBox", `0 0 ${w} ${h}`);
    cachedProjection = makeProjection(w, h);
    return cachedProjection;
  }

  // Draw background countries whenever worldGeo is available.
  // Separate from ensureLayout so it runs even when projection is cached.
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
  function prepareMapFlows(data, year) {
    const sel = state.selectedMapCountry;
    const topN = state.mapTopN || 20;

    let pool = sel
      ? data.filter(d => d.base_country_name === sel || d.target_country_name === sel)
      : data;

    // Sort by strength, remove zeros
    const sorted = pool
      .map(d => ({ d, abs: Math.abs(getFlowValue(d, year)) }))
      .filter(o => o.abs > 0)
      .sort((a, b) => b.abs - a.abs);

    const totalAvailable = sorted.length;

    // Update slider max and number input to match available flows
    const slider = document.getElementById("mapTopNSlider");
    const numInput = document.getElementById("mapTopNInput");
    const label = document.getElementById("mapTopNValue");
    if (slider) {
      const roundedMax = Math.ceil(totalAvailable / 5) * 5;
      slider.max = Math.max(roundedMax, 5);
      if (+slider.value > totalAvailable) {
        slider.value = roundedMax;
        state.mapTopN = roundedMax;
      }
      if (numInput) numInput.max = totalAvailable;
      const showing = Math.min(topN, totalAvailable);
      if (label) label.textContent = `${showing} / ${totalAvailable}`;
    }

    return sorted.slice(0, topN).map(o => o.d);
  }

  // ─── Update (data-only; layout is stable) ────────────────────
  function update(data) {
    const projection = ensureLayout();
    ensureBackground(projection);
    const year = state.selectedYear;

    const mapData = prepareMapFlows(data, year);

    // Status label
    const statusEl = document.getElementById("mapStatusLabel");
    if (statusEl) {
      const parts = [];
      if (state.selectedIncomeCell) parts.push("income pair");
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

    // --- Flow arcs ---
    g.selectAll(".flow-line")
      .data(mapData, d => `${d.base_country_name}-${d.target_country_name}`)
      .join(
        enter => enter.append("path")
          .attr("class", flowClass)
          .attr("d", flowPath)
          .attr("stroke-width", d => strokeScale(Math.abs(getFlowValue(d, year))))
          .style("stroke-opacity", d => opacityScale(Math.abs(getFlowValue(d, year))))
          .on("mouseover", function(event, d) {
            d3.select(this).classed("active", true);
            const v = getFlowValue(d, year);
            const dir = v >= 0 ? "inflow" : "outflow";
            showTooltip(event, `
              <strong>${d.base_country_name} \u2192 ${d.target_country_name}</strong><br/>
              <span style="opacity:0.7">${d.base_country_wb_income} \u2192 ${d.target_country_wb_income}</span><br/>
              ${year}: ${v.toFixed(2)} per 10K (${dir})
            `);
          })
          .on("mousemove", function(event) {
            tooltip.style("left", `${event.pageX + 12}px`).style("top", `${event.pageY + 12}px`);
          })
          .on("mouseout", function() {
            d3.select(this).classed("active", false);
            hideTooltip();
          }),
        update => update
          .attr("class", flowClass)
          .attr("d", flowPath)
          .attr("stroke-width", d => strokeScale(Math.abs(getFlowValue(d, year))))
          .style("stroke-opacity", d => opacityScale(Math.abs(getFlowValue(d, year))))
      );

    // --- Country nodes ---
    const nodesMap = new Map();
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
    });

    const nodes = Array.from(nodesMap.values());
    const sel = state.selectedMapCountry;

    g.selectAll(".country-node")
      .data(nodes, d => d.name)
      .join(
        enter => enter.append("circle")
          .attr("class", "country-node")
          .attr("r", 4)
          .attr("cx", d => proj(projection, d.lon, d.lat)[0])
          .attr("cy", d => proj(projection, d.lon, d.lat)[1])
          .on("mouseover", function(event, d) {
            d3.select(this).transition().duration(150).attr("r", 7);
            showTooltip(event, `<strong>${d.name}</strong><br/><span style="opacity:0.7">${d.income}</span>`);
          })
          .on("mousemove", function(event) {
            tooltip.style("left", `${event.pageX + 12}px`).style("top", `${event.pageY + 12}px`);
          })
          .on("mouseout", function() {
            d3.select(this).transition().duration(150).attr("r", 4);
            hideTooltip();
          })
          .on("click", function(event, d) {
            event.stopPropagation();
            if (onCountryClick) onCountryClick(d.name);
          }),
        update => update
          .attr("cx", d => proj(projection, d.lon, d.lat)[0])
          .attr("cy", d => proj(projection, d.lon, d.lat)[1])
      );

    g.selectAll(".country-node").classed("selected", d => d.name === sel);
  }

  // Invalidate cached layout on window resize so the next update recomputes
  window.addEventListener("resize", () => { cachedProjection = null; bgDrawn = false; });

  return { update };
}
