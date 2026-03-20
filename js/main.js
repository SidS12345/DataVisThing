import { state } from "./state.js";
import { filterData } from "./utils.js";
import { createMapView } from "./mapView.js";
import { createBarView } from "./barView.js";
import { createLineView } from "./lineView.js";
import { createChordView } from "./chordView.js";
import { createHeatmapView } from "./heatmapView.js";

const tooltip = d3.select("#tooltip");


function onCountryClick(name) {
  state.selectedMapCountry = state.selectedMapCountry === name ? null : name;
  if (state.filteredData) mapView.update(state.filteredData);
}

function onHeatmapCellClick(origin, dest) {
  const sel = state.selectedIncomeCell;
  if (sel && sel.origin === origin && sel.dest === dest) {
    state.selectedIncomeCell = null;
  } else {
    state.selectedIncomeCell = { origin, dest };
  }
  updateSelectionLabel();
  render();
}

function updateSelectionLabel() {
  const label = d3.select("#heatmapSelectionLabel");
  const sel = state.selectedIncomeCell;
  if (sel) {
    const short = {
      "Low Income": "Low",
      "Lower Middle Income": "Lower middle",
      "Upper Middle Income": "Upper middle",
      "High Income": "High"
    };
    label.text(`Filtering: ${short[sel.origin]} \u2192 ${short[sel.dest]}  (click cell again to clear)`);
  } else {
    label.text("");
  }
}

const heatmapView = createHeatmapView("#heatmapView", state, tooltip, onHeatmapCellClick);
const mapView = createMapView("#mapView", state, tooltip, onCountryClick);
const barView = createBarView("#barView", state, tooltip);
const lineView = createLineView("#lineView", state, tooltip);
const chordView = createChordView("#chordView", state, tooltip);

// Zooming/panning with inertia (smooth glide) and horizontal wrapping.
function enableZoom(containerSelector) {
  const container = d3.select(containerSelector);
  const containerNode = container.node();

  // Read dimensions dynamically — they change on fullscreen/resize
  function getCw() { return containerNode.clientWidth || containerNode.getBoundingClientRect().width; }
  function getCh() { return containerNode.clientHeight || containerNode.getBoundingClientRect().height; }

  // --- helper: apply a d3 zoom transform to all map layers ---
  function applyTransform(t) {
    const s = t.toString();
    container.selectAll("g.bg-layer").attr("transform", s);
    container.selectAll("g.map-layer").attr("transform", s);
  }

  // --- inertia state ---
  let trail = [];          // recent {t, x, y} samples for velocity
  let inertiaId = null;    // requestAnimationFrame handle

  function cancelInertia() {
    if (inertiaId) { cancelAnimationFrame(inertiaId); inertiaId = null; }
  }

  // --- zoom behaviour ---
  const zoom = d3.zoom()
    .scaleExtent([1, 8])
    .on("zoom", (event) => {
      cancelInertia();

      // Clamp both axes so the map can't be dragged past its edges
      const k = event.transform.k;
      const minTx = getCw() * (1 - k);
      const minTy = getCh() * (1 - k);
      let tx = Math.min(0, Math.max(event.transform.x, minTx));
      let ty = Math.min(0, Math.max(event.transform.y, minTy));
      const clamped = d3.zoomIdentity.translate(tx, ty).scale(k);

      // Record trail for inertia (only during real user drags)
      const se = event.sourceEvent;
      if (se && (se.type === "mousemove" || se.type === "touchmove")) {
        trail.push({ t: performance.now(), x: clamped.x, y: clamped.y });
        if (trail.length > 6) trail.shift();
      }

      applyTransform(clamped);
      // keep D3 in sync with our clamped version
      container.property("__zoom", clamped);
    })
    .on("end", (event) => {
      // --- inertia: compute velocity from recent trail and animate ---
      if (trail.length < 2) { trail = []; return; }

      const newest = trail[trail.length - 1];
      const oldest = trail[0];
      const dt = (newest.t - oldest.t) / 1000;
      trail = [];
      if (dt < 0.005 || dt > 0.3) return;        // too slow or too stale

      let vx = (newest.x - oldest.x) / dt;
      let vy = (newest.y - oldest.y) / dt;
      const speed = Math.sqrt(vx * vx + vy * vy);
      if (speed < 80) return;                     // not enough momentum

      // cap max velocity
      const cap = 4000;
      if (speed > cap) { vx = vx / speed * cap; vy = vy / speed * cap; }

      const friction = 0.95;                      // per-frame multiplier (~60 fps)
      let tx = newest.x;
      let ty = newest.y;
      const k = event.transform.k;
      const minTy = getCh() * (1 - k);
      let prev = performance.now();

      function step() {
        const now = performance.now();
        const elapsed = (now - prev) / 1000;
        prev = now;

        // frame-rate-independent friction
        const decay = Math.pow(friction, elapsed * 60);
        vx *= decay;
        vy *= decay;

        const minTx = getCw() * (1 - k);
        tx = Math.min(0, Math.max(tx + vx * elapsed, minTx));
        ty = Math.min(0, Math.max(ty + vy * elapsed, minTy));

        if (Math.abs(vx) < 0.5 && Math.abs(vy) < 0.5) { inertiaId = null; return; }

        const t = d3.zoomIdentity.translate(tx, ty).scale(k);
        applyTransform(t);
        container.property("__zoom", t);          // sync D3 internal state

        inertiaId = requestAnimationFrame(step);
      }

      inertiaId = requestAnimationFrame(step);
    });

  container.call(zoom);

  // --- zoom controls (+/−) ---
  const parent = d3.select(container.node().parentNode).style("position", "relative");
  const controls = parent.selectAll("div.zoom-controls").data([null]).join("div")
    .attr("class", "zoom-controls")
    .style("position", "absolute")
    .style("top", "50px")
    .style("right", "26px")
    .style("z-index", 999)
    .style("pointer-events", "auto");

  controls.selectAll("button").data(["in", "out"])
    .join("button")
    .attr("class", d => `zoom-btn ${d === "in" ? "zoom-in" : "zoom-out"}`)
    .text(d => d === "in" ? "+" : "\u2212");

  controls.select("button.zoom-in").on("click", (event) => {
    event.preventDefault();
    cancelInertia();
    container.transition().duration(350).call(zoom.scaleBy, 1.5);
  });
  controls.select("button.zoom-out").on("click", (event) => {
    event.preventDefault();
    cancelInertia();
    container.transition().duration(350).call(zoom.scaleBy, 1 / 1.5);
  });

  container.on("dblclick.zoom", null);
  return zoom;
}

enableZoom("#mapView");

function populateCountryDropdown(data) {
  const countries = new Set();

  data.forEach(d => {
    countries.add(d.base_country_name);
    countries.add(d.target_country_name);
  });

  const sortedCountries = Array.from(countries).sort(d3.ascending);

  d3.select("#countrySelect")
    .selectAll("option.country-option")
    .data(sortedCountries)
    .join("option")
    .attr("class", "country-option")
    .attr("value", d => d)
    .text(d => d);
}

function render() {
  state.filteredData = filterData(state.rawData, state);
  heatmapView.update(state.filteredData);
  mapView.update(state.filteredData);
  barView.update(state.filteredData);
  lineView.update(state.filteredData);
  chordView.update(state.filteredData);
}

function setupControls() {
  d3.select("#yearSelect").on("change", function() {
    state.selectedYear = +this.value;
    render();
  });

  d3.select("#countrySelect").on("change", function() {
    state.selectedCountry = this.value;
    render();
  });

  d3.select("#positiveOnly").on("change", function() {
    state.positiveOnly = this.checked;
    render();
  });

  d3.select("#mapTopNSlider").on("input", function() {
    state.mapTopN = +this.value;
    d3.select("#mapTopNValue").text(this.value);
    if (state.filteredData) mapView.update(state.filteredData);
  });
}

d3.csv("data/country_linked.csv", d3.autoType).then(data => {
  state.rawData = data;
  populateCountryDropdown(data);
  setupControls();
  render();
}).catch(error => {
  console.error("Error loading CSV:", error);
});