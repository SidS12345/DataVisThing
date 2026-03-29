// mapView.js
// Renders the geographic flow map with curved arcs between countries.
// Blue arcs = inflow, red arcs = outflow. Country dots at endpoints.
// The zoom/pan behaviour with inertia is set up in index.js since
// it needs to know about the SVG layers created here.

import {
  INCOME_SHORT,
  getFlowValue,
  showTooltip,
  moveTooltip,
  hideTooltip
} from './utils.js';

// clip bounds for the mercator projection (cut off Antarctica)
const CLIP_RECT = {
  type: 'Polygon',
  coordinates: [[[-180, 84], [180, 84], [180, -58], [-180, -58], [-180, 84]]]
};

// colours for income-pair node highlighting
const ORIGIN_COLOUR = '#f59e0b';  // amber for sending countries
const DEST_COLOUR   = '#2563eb';  // blue for receiving countries
const BOTH_COLOUR   = '#8b5cf6';  // purple when a country is both


export function flowMapView(svg, props) {
  const {
    flows,
    year,
    hover,
    selectedIncomeCell: incomeCell,
    selectedMapCountry,
    worldGeo,
    onCountryClick,
    onHover
  } = props;

  // --- projection setup ---
  const parent = svg.node().parentNode;
  const parentWidth = parent.clientWidth;
  const width = (parentWidth > 32) ? parentWidth - 32 : 800;

  // compute height from the projection's natural aspect ratio
  const tempProjection = d3.geoMercator().fitWidth(width, CLIP_RECT);
  const topEdge = tempProjection([-180, 84]);
  const bottomEdge = tempProjection([180, -58]);
  const height = Math.ceil(bottomEdge[1] - topEdge[1]);

  svg.attr('viewBox', `0 0 ${width} ${height}`)
     .attr('preserveAspectRatio', 'xMidYMin meet')
     .style('height', `${height}px`);

  const projection = d3.geoMercator().fitSize([width, height], CLIP_RECT);
  const pathGenerator = d3.geoPath(projection);

  // helper to project a lon/lat pair to screen coordinates
  function project(lon, lat) {
    return projection([+lon, +lat]);
  }

  // --- layer groups (one-element joins so they stay stable) ---
  const bgLayer = svg.selectAll('g.bg-layer').data([null]).join('g')
    .attr('class', 'bg-layer');
  const arcLayer = svg.selectAll('g.map-layer').data([null]).join('g')
    .attr('class', 'map-layer');
  const legendLayer = svg.selectAll('g.map-legend-layer').data([null]).join('g')
    .attr('class', 'map-legend-layer');

  // clicking empty space deselects the focused country
  svg.on('click.deselect', function() {
    if (selectedMapCountry && onCountryClick) {
      onCountryClick(null);
    }
  });

  // --- background country shapes ---
  if (worldGeo) {
    bgLayer.selectAll('path.country')
      .data(worldGeo.features, d => d.id || d.properties.name)
      .join(enter => enter.append('path')
        .attr('class', 'country')
        .attr('fill', '#f2efe9')
        .attr('stroke', '#d5d2c8')
        .attr('stroke-width', 0.5)
      )
      .attr('d', pathGenerator);
  }

  // --- scales for arc thickness and opacity ---
  const rawMaxFlow = d3.max(flows, d => Math.abs(getFlowValue(d, year)));
  const maxAbsFlow = rawMaxFlow || 1;
  const thicknessScale = d3.scaleSqrt()
    .domain([0, maxAbsFlow])
    .range([1, 7]);
  const opacityScale = d3.scaleSqrt()
    .domain([0, maxAbsFlow])
    .range([0.25, 0.85]);

  // builds a quadratic bezier arc between two country positions
  function arcPath(d) {
    const startPoint = project(d.base_long, d.base_lat);
    const endPoint = project(d.target_long, d.target_lat);
    const x1 = startPoint[0];
    const y1 = startPoint[1];
    const x2 = endPoint[0];
    const y2 = endPoint[1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    // offset the control point perpendicular to the line for a gentle curve
    const cx = (x1 + x2) / 2 - dy * 0.15;
    const cy = (y1 + y2) / 2 + dx * 0.15;
    return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
  }

  // positive flows get the blue class, negative get red
  function arcClass(d) {
    const flowVal = getFlowValue(d, year);
    if (flowVal >= 0) {
      return 'flow-line flow-positive';
    }
    return 'flow-line flow-negative';
  }

  // --- flow arcs (enter/update/exit with transitions) ---
  arcLayer.selectAll('.flow-line')
    .data(flows, d => `${d.base_country_name}-${d.target_country_name}`)
    .join(
      enter => {
        const enterPaths = enter.append('path')
          .attr('class', arcClass)
          .attr('d', arcPath)
          .attr('stroke-width', d => thicknessScale(Math.abs(getFlowValue(d, year))))
          .style('stroke-opacity', 0);
        enterPaths.transition().duration(500)
          .style('stroke-opacity', d => opacityScale(Math.abs(getFlowValue(d, year))));
        return enterPaths;
      },
      update => {
        update
          .attr('class', arcClass)
          .attr('d', arcPath);
        update.transition().duration(500)
          .attr('stroke-width', d => thicknessScale(Math.abs(getFlowValue(d, year))))
          .style('stroke-opacity', d => opacityScale(Math.abs(getFlowValue(d, year))));
        return update;
      },
      exit => {
        exit.transition().duration(300)
          .style('stroke-opacity', 0)
          .remove();
        return exit;
      }
    )
    .on('mouseover', function(event, d) {
      d3.select(this).classed('active', true);
      const value = getFlowValue(d, year);
      let direction = 'inflow';
      if (value < 0) {
        direction = 'outflow';
      }
      const formatted = d3.format('+.2f')(value);
      const tooltipHtml =
        `<strong>${d.base_country_name} \u2192 ${d.target_country_name}</strong><br/>` +
        `<span style="opacity:0.7">${d.base_country_wb_income} \u2192 ${d.target_country_wb_income}</span><br/>` +
        `${year}: ${formatted} per 10K (${direction})`;
      showTooltip(event, tooltipHtml);
      if (onHover) {
        onHover({
          type: 'flow',
          base: d.base_country_name,
          target: d.target_country_name,
          baseIncome: d.base_country_wb_income,
          targetIncome: d.target_country_wb_income
        });
      }
    })
    .on('mousemove', function(event) {
      moveTooltip(event);
    })
    .on('mouseout', function() {
      d3.select(this).classed('active', false);
      hideTooltip();
      if (onHover) onHover(null);
    })
    // cross-view highlight: dim arcs that don't match the current hover
    .style('opacity', d => {
      if (!hover) return null;

      let match = false;
      if (hover.type === 'country') {
        const isBase = d.base_country_name === hover.name;
        const isTarget = d.target_country_name === hover.name;
        match = isBase || isTarget;
      } else if (hover.type === 'incomeCell') {
        const baseMatches = d.base_country_wb_income === hover.origin;
        const targetMatches = d.target_country_wb_income === hover.dest;
        match = baseMatches && targetMatches;
      } else if (hover.type === 'flow') {
        const baseMatches = d.base_country_name === hover.base;
        const targetMatches = d.target_country_name === hover.target;
        match = baseMatches && targetMatches;
      }

      if (match) return 1;
      return 0.08;
    });

  // --- build unique country nodes ---
  // we also track each country's role (origin, dest, or both) for income-pair colouring
  const countryNodes = new Map();
  const countryRoles = new Map();

  flows.forEach(d => {
    // add the base country if we haven't seen it yet
    if (!countryNodes.has(d.base_country_name)) {
      countryNodes.set(d.base_country_name, {
        name: d.base_country_name,
        income: d.base_country_wb_income,
        lat: +d.base_lat,
        lon: +d.base_long
      });
    }
    // add the target country if we haven't seen it yet
    if (!countryNodes.has(d.target_country_name)) {
      countryNodes.set(d.target_country_name, {
        name: d.target_country_name,
        income: d.target_country_wb_income,
        lat: +d.target_lat,
        lon: +d.target_long
      });
    }
    // only track roles when an income cell is selected
    if (incomeCell) {
      if (!countryRoles.has(d.base_country_name)) {
        countryRoles.set(d.base_country_name, new Set());
      }
      countryRoles.get(d.base_country_name).add('origin');
      if (!countryRoles.has(d.target_country_name)) {
        countryRoles.set(d.target_country_name, new Set());
      }
      countryRoles.get(d.target_country_name).add('dest');
    }
  });

  // picks the dot colour based on what role the country plays
  function dotColour(d) {
    if (!incomeCell) return null;
    const roles = countryRoles.get(d.name);
    if (!roles) return null;
    const isOrigin = roles.has('origin');
    const isDest = roles.has('dest');
    if (isOrigin && isDest) return BOTH_COLOUR;
    if (isOrigin) return ORIGIN_COLOUR;
    return DEST_COLOUR;
  }

  const nodes = Array.from(countryNodes.values());

  // --- country endpoint dots ---
  arcLayer.selectAll('.country-node')
    .data(nodes, d => d.name)
    .join(
      enter => {
        const enterCircles = enter.append('circle')
          .attr('class', 'country-node')
          .attr('cx', d => project(d.lon, d.lat)[0])
          .attr('cy', d => project(d.lon, d.lat)[1])
          .attr('r', 0);
        enterCircles.transition().duration(400).attr('r', 4);
        return enterCircles;
      },
      update => update
        .attr('cx', d => project(d.lon, d.lat)[0])
        .attr('cy', d => project(d.lon, d.lat)[1]),
      exit => {
        exit.transition().duration(300).attr('r', 0).remove();
        return exit;
      }
    )
    .style('fill', d => dotColour(d))
    .classed('selected', d => d.name === selectedMapCountry)
    .on('mouseover', function(event, d) {
      d3.select(this).transition().duration(150).attr('r', 7);
      const tooltipHtml = `<strong>${d.name}</strong><br/><span style="opacity:0.7">${d.income}</span>`;
      showTooltip(event, tooltipHtml);
      if (onHover) {
        onHover({ type: 'country', name: d.name, income: d.income });
      }
    })
    .on('mousemove', function(event) {
      moveTooltip(event);
    })
    .on('mouseout', function() {
      d3.select(this).transition().duration(150).attr('r', 4);
      hideTooltip();
      if (onHover) onHover(null);
    })
    .on('click', function(event, d) {
      event.stopPropagation();
      if (onCountryClick) onCountryClick(d.name);
    })
    // cross-view highlight: dim nodes that don't match the hover
    .style('opacity', d => {
      if (!hover) return 1;
      if (hover.type === 'country') {
        if (d.name === hover.name) return 1;
        return 0.2;
      }
      if (hover.type === 'flow') {
        const isInvolved = d.name === hover.base || d.name === hover.target;
        if (isInvolved) return 1;
        return 0.2;
      }
      return 1;
    });

  // --- flow direction legend (always visible, never changes content) ---
  const directionLegend = legendLayer.selectAll('g.flow-dir-legend').data([null]).join('g')
    .attr('class', 'flow-dir-legend')
    .attr('transform', `translate(${width - 156}, ${height - 44})`);

  directionLegend.selectAll('rect.fd-bg').data([null]).join('rect')
    .attr('class', 'fd-bg')
    .attr('width', 144)
    .attr('height', 36)
    .attr('rx', 6)
    .attr('fill', 'rgba(255,255,255,0.92)')
    .attr('stroke', '#dbe2ea');

  directionLegend.selectAll('line.fd-pos').data([null]).join('line')
    .attr('class', 'fd-pos')
    .attr('x1', 10).attr('x2', 32)
    .attr('y1', 12).attr('y2', 12)
    .attr('stroke', '#2563eb')
    .attr('stroke-width', 2.5)
    .attr('stroke-linecap', 'round');
  directionLegend.selectAll('text.fd-pos-t').data([null]).join('text')
    .attr('class', 'fd-pos-t')
    .attr('x', 38).attr('y', 16)
    .attr('font-size', '10px').attr('fill', '#374151')
    .text('Inflow (+)');

  directionLegend.selectAll('line.fd-neg').data([null]).join('line')
    .attr('class', 'fd-neg')
    .attr('x1', 10).attr('x2', 32)
    .attr('y1', 26).attr('y2', 26)
    .attr('stroke', '#ef4444')
    .attr('stroke-width', 2.5)
    .attr('stroke-linecap', 'round');
  directionLegend.selectAll('text.fd-neg-t').data([null]).join('text')
    .attr('class', 'fd-neg-t')
    .attr('x', 38).attr('y', 30)
    .attr('font-size', '10px').attr('fill', '#374151')
    .text('Outflow (\u2212)');

  // --- income pair legend (only shows when an income cell is selected) ---
  const incomeLegendData = incomeCell ? [incomeCell] : [];
  legendLayer.selectAll('g.income-legend')
    .data(incomeLegendData)
    .join(
      enter => {
        const enterGroup = enter.append('g')
          .attr('class', 'income-legend')
          .style('opacity', 0);
        enterGroup.transition().duration(400).style('opacity', 1);
        return enterGroup;
      },
      update => update,
      exit => exit.transition().duration(200).style('opacity', 0).remove()
    )
    .each(function(sel) {
      const legendGroup = d3.select(this);
      const originLabel = INCOME_SHORT[sel.origin] || sel.origin;
      const destLabel   = INCOME_SHORT[sel.dest]   || sel.dest;
      const sameLevel   = sel.origin === sel.dest;

      // adjust height based on whether both roles are the same level
      let legendHeight = 52;
      if (sameLevel) {
        legendHeight = 32;
      }

      const legendY = height - legendHeight - 12;
      legendGroup.attr('transform', `translate(16, ${legendY})`);

      // background box
      legendGroup.selectAll('rect.inc-bg').data([null]).join('rect')
        .attr('class', 'inc-bg')
        .attr('width', 200)
        .attr('height', legendHeight)
        .attr('rx', 8)
        .attr('fill', 'rgba(255,255,255,0.92)')
        .attr('stroke', '#dbe2ea');

      // build the legend items as data
      let items = [];
      if (sameLevel) {
        items = [
          { colour: BOTH_COLOUR, text: `${originLabel} (both roles)`, cy: 16 }
        ];
      } else {
        items = [
          { colour: ORIGIN_COLOUR, text: `Origin: ${originLabel}`, cy: 16 },
          { colour: DEST_COLOUR,   text: `Dest: ${destLabel}`,     cy: 36 }
        ];
      }

      legendGroup.selectAll('circle.inc-dot').data(items).join('circle')
        .attr('class', 'inc-dot')
        .attr('cx', 14)
        .attr('cy', d => d.cy)
        .attr('r', 5)
        .attr('fill', d => d.colour);

      legendGroup.selectAll('text.inc-label').data(items).join('text')
        .attr('class', 'inc-label')
        .attr('x', 26)
        .attr('y', d => d.cy + 4)
        .attr('font-size', '11px')
        .attr('fill', '#374151')
        .text(d => d.text);
    });
}
