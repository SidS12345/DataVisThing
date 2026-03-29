// index.js
// Main entry point for the migration dashboard.
// This file loads the CSV data, manages the shared dashboard state,
// wires up all the UI controls (year buttons, country dropdown, etc.),
// and calls updateVis() whenever the state changes to re-render all views.

import {
  INCOME_SHORT,
  filterData,
  getFlowValue
} from './utils.js';

import { heatmapView } from './heatmapView.js';
import { flowMapView } from './mapView.js';
import { barView } from './barView.js';
import { lineView } from './lineView.js';
import { updateInsights } from './insightsView.js';


// ---- shared dashboard state ----
// all the current filter values and data live here
const state = {
  rawData: [],
  filteredData: [],
  selectedYear: 2019,
  selectedCountry: 'all',
  positiveOnly: false,
  selectedIncomeCell: null,   // { origin, dest } or null
  selectedMapCountry: null,
  mapTopN: 20,
  hover: null,
  worldGeo: null              // loaded asynchronously after boot
};


// ---- main update function ----
// this is called whenever the state changes and pushes
// the current state into every view as explicit props

function updateVis() {
  // apply filters to the raw data
  state.filteredData = filterData(state.rawData, state);

  // work out which flows to show on the map
  const mapFlows = getMapFlows();

  // call each view with its props
  heatmapView(d3.select('#heatmapView'), {
    rawData: state.rawData,
    year: state.selectedYear,
    selectedCountry: state.selectedCountry,
    positiveOnly: state.positiveOnly,
    selectedIncomeCell: state.selectedIncomeCell,
    hover: state.hover,
    onCellClick: handleCellClick,
    onHover: handleHover
  });

  flowMapView(d3.select('#mapView'), {
    flows: mapFlows,
    year: state.selectedYear,
    selectedIncomeCell: state.selectedIncomeCell,
    selectedMapCountry: state.selectedMapCountry,
    hover: state.hover,
    worldGeo: state.worldGeo,
    onCountryClick: handleCountryClick,
    onHover: handleHover
  });

  barView(d3.select('#barView'), {
    data: state.filteredData,
    year: state.selectedYear,
    hover: state.hover,
    onHover: handleHover
  });

  // line view always gets rawData so it can show all years,
  // not just the currently selected one
  lineView(d3.select('#lineView'), {
    rawData: state.rawData,
    selectedCountry: state.selectedCountry,
    selectedIncomeCell: state.selectedIncomeCell
  });

  // update the text-based parts of the UI
  updateInsights(state.filteredData, state);
  updateHeatmapLabel();
  updateFilterDisplay();
  updateLineLabel();

  // apply smooth cross-view hover transitions
  applyHighlight(state.hover);
}

// lighter update path for map-only changes (slider drag, country click)
// so we don't re-render the whole dashboard on every slider tick
function updateMapOnly() {
  const mapFlows = getMapFlows();
  flowMapView(d3.select('#mapView'), {
    flows: mapFlows,
    year: state.selectedYear,
    selectedIncomeCell: state.selectedIncomeCell,
    selectedMapCountry: state.selectedMapCountry,
    hover: state.hover,
    worldGeo: state.worldGeo,
    onCountryClick: handleCountryClick,
    onHover: handleHover
  });
  applyHighlight(state.hover);
}


// ---- cross-view hover highlighting ----
// each view sets its own highlight from props.hover during render,
// but this function adds smooth 150ms transitions for real-time
// hover events that happen between full renders

function handleHover(hoverInfo) {
  state.hover = hoverInfo;
  applyHighlight(hoverInfo);
}

function applyHighlight(hoverInfo) {
  const selectedCell = state.selectedIncomeCell;

  // heatmap cells: use CSS filter to dim non-matching cells
  // (we use filter rather than opacity because opacity is already
  // used for the cell selection dimming)
  d3.selectAll('rect.hm-cell')
    .transition('highlight').duration(150)
    .style('filter', d => {
      // don't dim for our own hover type
      if (!hoverInfo) return null;
      if (hoverInfo.type === 'incomeCell') return null;

      // never dim the currently selected cell
      if (selectedCell) {
        const isSelected = selectedCell.origin === d.origin && selectedCell.dest === d.dest;
        if (isSelected) return null;
      }

      // check if this cell matches the hover
      let match = false;
      if (hoverInfo.type === 'country') {
        match = d.origin === hoverInfo.income || d.dest === hoverInfo.income;
      } else if (hoverInfo.type === 'flow') {
        match = d.origin === hoverInfo.baseIncome && d.dest === hoverInfo.targetIncome;
      }

      if (match) return null;
      return 'brightness(0.5) saturate(0.3)';
    });

  // map arcs: fade out non-matching arcs
  d3.selectAll('.flow-line')
    .transition('highlight').duration(150)
    .style('opacity', d => {
      if (!hoverInfo) return 1;

      let match = false;
      if (hoverInfo.type === 'country') {
        const isBase = d.base_country_name === hoverInfo.name;
        const isTarget = d.target_country_name === hoverInfo.name;
        match = isBase || isTarget;
      } else if (hoverInfo.type === 'incomeCell') {
        const baseOk = d.base_country_wb_income === hoverInfo.origin;
        const targetOk = d.target_country_wb_income === hoverInfo.dest;
        match = baseOk && targetOk;
      } else if (hoverInfo.type === 'flow') {
        const baseOk = d.base_country_name === hoverInfo.base;
        const targetOk = d.target_country_name === hoverInfo.target;
        match = baseOk && targetOk;
      }

      if (match) return 1;
      return 0.08;
    });

  // map country dots: fade out non-matching nodes
  d3.selectAll('.country-node')
    .transition('highlight').duration(150)
    .style('opacity', d => {
      if (!hoverInfo) return 1;

      if (hoverInfo.type === 'country') {
        if (d.name === hoverInfo.name) return 1;
        return 0.2;
      }
      if (hoverInfo.type === 'flow') {
        const isInvolved = d.name === hoverInfo.base || d.name === hoverInfo.target;
        if (isInvolved) return 1;
        return 0.2;
      }
      return 1;
    });

  // bar chart: fade out non-matching bars
  d3.selectAll('rect.bar')
    .transition('highlight').duration(150)
    .style('opacity', d => {
      if (!hoverInfo) return 1;

      if (hoverInfo.type === 'country') {
        if (d.country === hoverInfo.name) return 1;
        return 0.15;
      }
      if (hoverInfo.type === 'flow') {
        if (d.country === hoverInfo.target) return 1;
        return 0.15;
      }
      return 1;
    });
}


// ---- callbacks from views ----

// called when a heatmap cell is clicked: toggle the income pair filter
function handleCellClick(origin, dest) {
  const current = state.selectedIncomeCell;
  if (current && current.origin === origin && current.dest === dest) {
    // clicking the same cell again deselects it
    state.selectedIncomeCell = null;
  } else {
    state.selectedIncomeCell = { origin, dest };
  }
  updateVis();
}

// called when a country dot on the map is clicked: toggle focus
function handleCountryClick(name) {
  if (state.selectedMapCountry === name) {
    state.selectedMapCountry = null;
  } else {
    state.selectedMapCountry = name;
  }
  updateMapOnly();
}


// ---- compute which flows to show on the map ----
// also updates the slider and status label DOM elements

function getMapFlows() {
  const data = state.filteredData;
  const year = state.selectedYear;
  const focusedCountry = state.selectedMapCountry;
  const topN = state.mapTopN || 20;

  // if a country is focused on the map, only show flows involving it
  let pool = data;
  if (focusedCountry) {
    pool = data.filter(d =>
      d.base_country_name === focusedCountry ||
      d.target_country_name === focusedCountry
    );
  }

  // compute the absolute flow value for each row
  const withAbsValues = pool.map(d => {
    const absValue = Math.abs(getFlowValue(d, year));
    return { row: d, absValue: absValue };
  });

  // filter out zero flows
  const nonZero = withAbsValues.filter(item => item.absValue > 0);

  // sort by absolute value, largest first
  const sorted = nonZero.sort((a, b) => b.absValue - a.absValue);

  // take only the top N
  const totalAvailable = sorted.length;
  const showing = Math.min(topN, totalAvailable);
  const topFlows = sorted.slice(0, topN);
  const flows = topFlows.map(item => item.row);

  // update the slider and count label
  const countLabel = document.getElementById('mapTopNValue');
  const slider = document.getElementById('mapTopNSlider');
  const numberInput = document.getElementById('mapTopNInput');

  if (countLabel) {
    countLabel.textContent = `${showing} / ${totalAvailable}`;
  }
  if (slider) {
    const roundedMax = Math.ceil(totalAvailable / 5) * 5;
    const sliderMax = Math.max(roundedMax, 5);
    slider.max = sliderMax;
    if (+slider.value > totalAvailable) {
      slider.value = roundedMax;
      state.mapTopN = roundedMax;
    }
  }
  if (numberInput) {
    numberInput.max = totalAvailable;
  }

  // update the status text next to the slider
  const statusElement = document.getElementById('mapStatusLabel');
  if (statusElement) {
    const parts = [];
    if (state.selectedIncomeCell) {
      const cell = state.selectedIncomeCell;
      const originLabel = INCOME_SHORT[cell.origin];
      const destLabel = INCOME_SHORT[cell.dest];
      parts.push(`${originLabel} \u2192 ${destLabel}`);
    }
    if (state.selectedMapCountry) {
      parts.push(state.selectedMapCountry);
    }
    if (state.selectedCountry !== 'all') {
      parts.push(state.selectedCountry);
    }

    let context = 'all countries';
    if (parts.length > 0) {
      context = parts.join(' + ');
    }

    let plural = '';
    if (flows.length !== 1) {
      plural = 's';
    }
    statusElement.textContent = `${flows.length} flow${plural} \u2014 ${context}, ${year}`;
  }

  return flows;
}


// ---- zoom with drag inertia ----
// this gives the map a smooth Google Maps-like feel when dragging

function enableZoom(selector) {
  const container = d3.select(selector);
  const containerNode = container.node();

  // read container dimensions (can change on resize)
  function containerWidth() {
    return containerNode.clientWidth || containerNode.getBoundingClientRect().width;
  }
  function containerHeight() {
    return containerNode.clientHeight || containerNode.getBoundingClientRect().height;
  }

  // applies a zoom transform to the background and flow layers
  function setTransform(transform) {
    const transformStr = transform.toString();
    container.selectAll('g.bg-layer').attr('transform', transformStr);
    container.selectAll('g.map-layer').attr('transform', transformStr);
  }

  // inertia tracking
  let trail = [];
  let inertiaId = null;
  function cancelInertia() {
    if (inertiaId) {
      cancelAnimationFrame(inertiaId);
      inertiaId = null;
    }
  }

  const zoom = d3.zoom()
    .scaleExtent([1, 8])
    .on('zoom', (event) => {
      cancelInertia();

      // clamp so the map can't be dragged past its edges
      const k = event.transform.k;
      const minTx = containerWidth() * (1 - k);
      const minTy = containerHeight() * (1 - k);
      let tx = Math.min(0, Math.max(event.transform.x, minTx));
      let ty = Math.min(0, Math.max(event.transform.y, minTy));
      const clamped = d3.zoomIdentity.translate(tx, ty).scale(k);

      // record position samples for inertia calculation
      const sourceEvent = event.sourceEvent;
      const isDrag = sourceEvent &&
        (sourceEvent.type === 'mousemove' || sourceEvent.type === 'touchmove');
      if (isDrag) {
        trail.push({ t: performance.now(), x: clamped.x, y: clamped.y });
        if (trail.length > 6) {
          trail.shift();
        }
      }

      setTransform(clamped);
      container.property('__zoom', clamped);
    })
    .on('end', (event) => {
      // calculate velocity from the recent trail and coast to a stop
      if (trail.length < 2) {
        trail = [];
        return;
      }

      const newest = trail[trail.length - 1];
      const oldest = trail[0];
      const timeDelta = (newest.t - oldest.t) / 1000;
      trail = [];

      // ignore if the trail is too short or too stale
      if (timeDelta < 0.005 || timeDelta > 0.3) return;

      let vx = (newest.x - oldest.x) / timeDelta;
      let vy = (newest.y - oldest.y) / timeDelta;
      const speed = Math.sqrt(vx * vx + vy * vy);

      // not enough momentum to coast
      if (speed < 80) return;

      // cap the velocity so it doesn't fly off screen
      const maxSpeed = 4000;
      if (speed > maxSpeed) {
        const ratio = maxSpeed / speed;
        vx = vx * ratio;
        vy = vy * ratio;
      }

      const friction = 0.95;
      let tx = newest.x;
      let ty = newest.y;
      const k = event.transform.k;
      const minTy = containerHeight() * (1 - k);
      let prev = performance.now();

      function coastStep() {
        const now = performance.now();
        const elapsed = (now - prev) / 1000;
        prev = now;

        // frame-rate-independent friction
        const decay = Math.pow(friction, elapsed * 60);
        vx = vx * decay;
        vy = vy * decay;

        const minTx = containerWidth() * (1 - k);
        tx = Math.min(0, Math.max(tx + vx * elapsed, minTx));
        ty = Math.min(0, Math.max(ty + vy * elapsed, minTy));

        // stop coasting when velocity is negligible
        if (Math.abs(vx) < 0.5 && Math.abs(vy) < 0.5) {
          inertiaId = null;
          return;
        }

        const transform = d3.zoomIdentity.translate(tx, ty).scale(k);
        setTransform(transform);
        container.property('__zoom', transform);
        inertiaId = requestAnimationFrame(coastStep);
      }

      inertiaId = requestAnimationFrame(coastStep);
    });

  container.call(zoom);

  // add +/- zoom buttons to the map panel
  const parentDiv = d3.select(containerNode.parentNode)
    .style('position', 'relative');

  const buttons = parentDiv.selectAll('div.zoom-controls').data([null]).join('div')
    .attr('class', 'zoom-controls')
    .style('position', 'absolute')
    .style('top', '50px')
    .style('right', '26px')
    .style('z-index', 999)
    .style('pointer-events', 'auto');

  buttons.selectAll('button').data(['in', 'out']).join('button')
    .attr('class', d => {
      if (d === 'in') return 'zoom-btn zoom-in';
      return 'zoom-btn zoom-out';
    })
    .text(d => {
      if (d === 'in') return '+';
      return '\u2212';
    });

  buttons.select('.zoom-in').on('click', (event) => {
    event.preventDefault();
    cancelInertia();
    container.transition().duration(350).call(zoom.scaleBy, 1.5);
  });
  buttons.select('.zoom-out').on('click', (event) => {
    event.preventDefault();
    cancelInertia();
    container.transition().duration(350).call(zoom.scaleBy, 1 / 1.5);
  });

  // disable double-click zoom (it's confusing with our custom zoom)
  container.on('dblclick.zoom', null);
}

// set up zoom on the map SVG
enableZoom('#mapView');


// ---- UI label updates ----

// shows/hides the "Filtering dashboard: X → Y" label above the heatmap
function updateHeatmapLabel() {
  const labelElement = d3.select('#heatmapSelectionLabel');
  const clearButton = d3.select('#heatmapClearBtn');
  const sel = state.selectedIncomeCell;
  if (sel) {
    const originLabel = INCOME_SHORT[sel.origin];
    const destLabel = INCOME_SHORT[sel.dest];
    labelElement.text(`Filtering dashboard: ${originLabel} \u2192 ${destLabel}`);
    clearButton.classed('hidden', false);
  } else {
    labelElement.text('');
    clearButton.classed('hidden', true);
  }
}

// updates the context label under the line chart title
function updateLineLabel() {
  const element = document.getElementById('lineViewContext');
  if (!element) return;

  if (state.selectedCountry !== 'all') {
    element.textContent = `Showing inbound and outbound flows for ${state.selectedCountry}`;
  } else if (state.selectedIncomeCell) {
    const originName = INCOME_SHORT[state.selectedIncomeCell.origin] || state.selectedIncomeCell.origin;
    const destName = INCOME_SHORT[state.selectedIncomeCell.dest] || state.selectedIncomeCell.dest;
    element.textContent = `Showing: ${originName} \u2192 ${destName} income pair`;
  } else {
    element.textContent = 'Showing: aggregate across all country pairs';
  }
}

// updates the year button highlights, filter pills, and reset button
function updateFilterDisplay() {
  // highlight the active year button
  d3.selectAll('.year-btn').classed('active', function() {
    return +this.dataset.year === state.selectedYear;
  });

  const container = d3.select('#activeFilters');
  if (container.empty()) return;

  // build up the list of active filter pills
  const pills = [];
  if (state.selectedCountry !== 'all') {
    pills.push({ label: state.selectedCountry, key: 'country' });
  }
  if (state.selectedIncomeCell) {
    const cell = state.selectedIncomeCell;
    const originLabel = INCOME_SHORT[cell.origin];
    const destLabel = INCOME_SHORT[cell.dest];
    pills.push({
      label: `${originLabel} \u2192 ${destLabel}`,
      key: 'income'
    });
  }
  if (state.positiveOnly) {
    pills.push({ label: 'Positive only', key: 'positive' });
  }

  // only show the reset button when filters are non-default
  const isDefault = pills.length === 0 && state.selectedYear === 2019;
  d3.select('#resetAllBtn').classed('hidden', isDefault);

  // summary text
  let summaryText = `Viewing: ${state.selectedYear}, all data`;
  if (pills.length > 0) {
    summaryText = `Viewing: ${state.selectedYear}`;
  }
  container.selectAll('.active-filters-summary').data([null]).join('span')
    .attr('class', 'active-filters-summary')
    .text(summaryText);

  // render the filter pills with a close button on each
  const pillSelection = container.selectAll('.filter-pill')
    .data(pills, d => d.key)
    .join(
      enter => {
        const span = enter.append('span').attr('class', 'filter-pill');
        span.append('span').attr('class', 'pill-text');
        span.append('button').attr('class', 'pill-close').html('&times;');
        return span;
      },
      update => update,
      exit => exit.remove()
    );

  pillSelection.select('.pill-text').text(d => d.label);
  pillSelection.select('.pill-close').on('click', function(event, d) {
    event.stopPropagation();
    if (d.key === 'country') {
      state.selectedCountry = 'all';
      document.getElementById('countrySelect').value = 'all';
    } else if (d.key === 'income') {
      state.selectedIncomeCell = null;
    } else if (d.key === 'positive') {
      state.positiveOnly = false;
      document.getElementById('positiveOnly').checked = false;
    }
    updateVis();
  });
}


// ---- controls setup ----
// wires up all the interactive controls in the UI

function setupControls() {
  // year toggle buttons
  d3.selectAll('.year-btn').on('click', function() {
    state.selectedYear = +this.dataset.year;
    updateVis();
  });

  // country dropdown
  d3.select('#countrySelect').on('change', function() {
    state.selectedCountry = this.value;
    updateVis();
  });

  // positive-only checkbox
  d3.select('#positiveOnly').on('change', function() {
    state.positiveOnly = this.checked;
    updateVis();
  });

  // reset all filters button
  d3.select('#resetAllBtn').on('click', function() {
    state.selectedYear = 2019;
    state.selectedCountry = 'all';
    state.selectedIncomeCell = null;
    state.positiveOnly = false;
    state.selectedMapCountry = null;
    document.getElementById('countrySelect').value = 'all';
    document.getElementById('positiveOnly').checked = false;
    updateVis();
  });

  // clear heatmap selection button
  d3.select('#heatmapClearBtn').on('click', function() {
    state.selectedIncomeCell = null;
    updateVis();
  });

  // map top-N slider (only updates the map, not the whole dashboard)
  d3.select('#mapTopNSlider').on('input', function() {
    state.mapTopN = +this.value;
    document.getElementById('mapTopNInput').value = state.mapTopN;
    updateMapOnly();
  });

  // map top-N number input
  d3.select('#mapTopNInput').on('change', function() {
    const rawValue = +this.value || 1;
    const value = Math.max(1, rawValue);
    this.value = value;
    state.mapTopN = value;
    document.getElementById('mapTopNSlider').value = value;
    updateMapOnly();
  });
}


// ---- populate country dropdown ----

function fillCountryDropdown(data) {
  const countries = new Set();
  data.forEach(d => {
    countries.add(d.base_country_name);
    countries.add(d.target_country_name);
  });

  const sortedCountries = Array.from(countries).sort(d3.ascending);

  d3.select('#countrySelect')
    .selectAll('option.country-option')
    .data(sortedCountries)
    .join('option')
    .attr('class', 'country-option')
    .attr('value', d => d)
    .text(d => d);
}


// ---- load data and boot the dashboard ----

d3.csv('data/country_linked.csv', d3.autoType).then(data => {
  console.log('Loaded ' + data.length + ' rows');
  state.rawData = data;
  fillCountryDropdown(data);
  setupControls();
  updateVis();

  // load the world GeoJSON asynchronously so the map background
  // fills in once it arrives (doesn't block the initial render)
  d3.json('https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson')
    .then(geo => {
      state.worldGeo = geo;
      updateVis();
    })
    .catch(err => console.error('GeoJSON load failed:', err));
}).catch(err => console.error('CSV load failed:', err));
