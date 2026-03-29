// heatmapView.js
// Renders a 4x4 income-level migration heatmap.
// Rows = origin income level, columns = destination income level.
// Uses a diverging colour scale: blue for net inflow, red for net outflow.
// Clicking a cell filters the rest of the dashboard to that income pair.

import {
  INCOME_ORDER,
  INCOME_SHORT,
  getFlowValue,
  showTooltip,
  moveTooltip,
  hideTooltip
} from './utils.js';

export function heatmapView(svg, props) {
  const {
    rawData, 
    year,
    selectedCountry, 
    positiveOnly,
    selectedIncomeCell: sel, 
    hover,
    onCellClick, 
    onHover
  } = props;

  // work out how much space we have
  const parent = svg.node().parentNode;
  const parentWidth = parent.clientWidth;
  const w = (parentWidth > 32) ? parentWidth - 32 : 600;
  const h = Math.max(svg.node().getBoundingClientRect().height, 380);
  svg.attr('viewBox', `0 0 ${w} ${h}`)
     .attr('preserveAspectRatio', 'xMidYMin meet');

  const margin = { top: 28, right: 100, bottom: 60, left: 120 };
  const gridWidth = w - margin.left - margin.right;
  const gridHeight = h - margin.top - margin.bottom;
  const cellWidth = gridWidth / 4;
  const cellHeight = gridHeight / 4;

  // create root group and defs (one-element joins so they persist)
  const defs = svg.selectAll('defs.hm-defs').data([null]).join('defs')
    .attr('class', 'hm-defs');
  const g = svg.selectAll('g.hm-root').data([null]).join('g')
    .attr('class', 'hm-root')
    .attr('transform', `translate(${margin.left}, ${margin.top})`);

  // --- aggregate data by income pair ---
  // the heatmap ignores the income cell filter so it always shows the full picture
  const filtered = rawData.filter(d => {
    const flow = getFlowValue(d, year);

    // check country filter
    let countryOk = false;
    if (selectedCountry === 'all') {
      countryOk = true;
    } else if (d.base_country_name === selectedCountry) {
      countryOk = true;
    } else if (d.target_country_name === selectedCountry) {
      countryOk = true;
    }

    // check positive-only filter
    let positiveOk = true;
    if (positiveOnly && flow <= 0) {
      positiveOk = false;
    }

    return countryOk && positiveOk;
  });

  // sum up flows for each origin-dest income pair
  const sums = new Map();
  let total = 0;
  INCOME_ORDER.forEach(originLevel => {
    INCOME_ORDER.forEach(destLevel => {
      sums.set(`${originLevel}|||${destLevel}`, 0);
    });
  });
  filtered.forEach(d => {
    const flowValue = getFlowValue(d, year);
    const key = `${d.base_country_wb_income}|||${d.target_country_wb_income}`;
    if (sums.has(key)) {
      const currentSum = sums.get(key);
      sums.set(key, currentSum + flowValue);
      total += flowValue;
    }
  });

  // flatten into an array of cell objects for the join
  const cells = [];
  INCOME_ORDER.forEach((origin, rowIndex) => {
    INCOME_ORDER.forEach((dest, colIndex) => {
      const cellValue = sums.get(`${origin}|||${dest}`);
      cells.push({
        origin: origin,
        dest: dest,
        value: cellValue,
        row: rowIndex,
        col: colIndex
      });
    });
  });

  // --- diverging colour scale ---
  const rawMax = d3.max(cells, d => Math.abs(d.value));
  const maxVal = rawMax || 1;
  const color = d3.scaleDiverging()
    .domain([-maxVal, 0, maxVal])
    .interpolator(d3.interpolateRdBu);

  // helper: is this cell the currently selected one?
  function isCellSelected(d) {
    if (!sel) return false;
    return sel.origin === d.origin && sel.dest === d.dest;
  }

  // --- draw cell rectangles ---
  const rects = g.selectAll('rect.hm-cell')
    .data(cells, d => `${d.row}-${d.col}`)
    .join('rect')
    .attr('class', 'hm-cell')
    .attr('x', d => d.col * cellWidth)
    .attr('y', d => d.row * cellHeight)
    .attr('width', cellWidth - 2)
    .attr('height', cellHeight - 2)
    .attr('rx', 4)
    .style('cursor', 'pointer')
    .on('mouseover', function(event, d) {
      // only show hover stroke if this cell isn't already selected
      if (!isCellSelected(d)) {
        d3.select(this).transition('hover').duration(150)
          .attr('stroke', '#1f2937')
          .attr('stroke-width', 2);
      }
      // calculate share of total for the tooltip
      let sharePercent = '0.0';
      if (total !== 0) {
        sharePercent = ((d.value / total) * 100).toFixed(1);
      }
      const originLabel = INCOME_SHORT[d.origin];
      const destLabel = INCOME_SHORT[d.dest];
      const flowFormatted = d3.format('+.2f')(d.value);
      const tooltipHtml =
        `<strong>${originLabel} \u2192 ${destLabel}</strong><br/>` +
        `Net flow: ${flowFormatted} per 10K<br/>` +
        `Share of total: ${sharePercent}%`;
      showTooltip(event, tooltipHtml);
      if (onHover) {
        onHover({ type: 'incomeCell', origin: d.origin, dest: d.dest });
      }
    })
    .on('mousemove', function(event) {
      moveTooltip(event);
    })
    .on('mouseout', function(event, d) {
      const selected = isCellSelected(d);
      const strokeColor = selected ? '#1f2937' : 'none';
      const strokeWidth = selected ? 3 : 0;
      d3.select(this).transition('hover').duration(150)
        .attr('stroke', strokeColor)
        .attr('stroke-width', strokeWidth);
      hideTooltip();
      if (onHover) onHover(null);
    })
    .on('click', function(event, d) {
      if (onCellClick) onCellClick(d.origin, d.dest);
    });

  // animate fill/stroke/opacity when selection changes
  rects.transition('select').duration(350)
    .attr('fill', d => color(d.value))
    .attr('stroke', d => {
      if (isCellSelected(d)) return '#1f2937';
      return 'none';
    })
    .attr('stroke-width', d => {
      if (isCellSelected(d)) return 3;
      return 0;
    })
    .style('opacity', d => {
      if (!sel) return 1;
      if (isCellSelected(d)) return 1;
      return 0.35;
    });

  // dim non-matching cells when hovering on a different view
  rects.style('filter', d => {
    // don't dim for our own hover type
    if (!hover) return null;
    if (hover.type === 'incomeCell') return null;

    // never dim the currently selected cell
    if (isCellSelected(d)) return null;

    // check if this cell matches the hover
    let match = false;
    if (hover.type === 'country') {
      match = d.origin === hover.income || d.dest === hover.income;
    } else if (hover.type === 'flow') {
      match = d.origin === hover.baseIncome && d.dest === hover.targetIncome;
    }

    if (match) return null;
    return 'brightness(0.5) saturate(0.3)';
  });

  // --- cell value labels ---
  g.selectAll('text.hm-value')
    .data(cells, d => `${d.row}-${d.col}`)
    .join('text')
    .attr('class', 'hm-value')
    .attr('x', d => d.col * cellWidth + (cellWidth - 2) / 2)
    .attr('y', d => d.row * cellHeight + (cellHeight - 2) / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', 'middle')
    .attr('font-size', '13px')
    .attr('font-weight', 600)
    .attr('fill', d => {
      // use white text on dark cells, dark text on light cells
      if (Math.abs(d.value) > maxVal * 0.6) return '#fff';
      return '#1f2937';
    })
    .style('pointer-events', 'none')
    .text(d => d3.format('+.1f')(d.value))
    .transition('select').duration(350)
    .style('opacity', d => {
      if (!sel) return 1;
      if (isCellSelected(d)) return 1;
      return 0.35;
    });

  // --- row labels (y-axis) ---
  g.selectAll('text.hm-y-label')
    .data(INCOME_ORDER).join('text')
    .attr('class', 'hm-y-label')
    .attr('x', -10)
    .attr('y', (d, i) => i * cellHeight + cellHeight / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', 'end')
    .attr('font-size', '12px')
    .attr('fill', '#1f2937')
    .text(d => INCOME_SHORT[d]);

  g.selectAll('text.hm-y-title').data([null]).join('text')
    .attr('class', 'hm-y-title')
    .attr('transform', 'rotate(-90)')
    .attr('x', -gridHeight / 2)
    .attr('y', -margin.left + 16)
    .attr('text-anchor', 'middle')
    .attr('font-size', '13px')
    .attr('font-weight', 600)
    .attr('fill', '#6b7280')
    .text('Origin income level');

  // --- column labels (x-axis) ---
  g.selectAll('text.hm-x-label')
    .data(INCOME_ORDER).join('text')
    .attr('class', 'hm-x-label')
    .attr('x', (d, i) => i * cellWidth + (cellWidth - 2) / 2)
    .attr('y', gridHeight + 16)
    .attr('text-anchor', 'middle')
    .attr('font-size', '12px')
    .attr('fill', '#1f2937')
    .text(d => INCOME_SHORT[d]);

  g.selectAll('text.hm-x-title').data([null]).join('text')
    .attr('class', 'hm-x-title')
    .attr('x', gridWidth / 2)
    .attr('y', gridHeight + 44)
    .attr('text-anchor', 'middle')
    .attr('font-size', '13px')
    .attr('font-weight', 600)
    .attr('fill', '#6b7280')
    .text('Destination income level');

  // --- colour legend on the right side ---
  const legendWidth = 16;
  const legendX = gridWidth + 24;

  // gradient definition for the legend bar
  const grad = defs.selectAll('linearGradient#hm-legend-grad').data([null])
    .join('linearGradient')
    .attr('id', 'hm-legend-grad')
    .attr('x1', '0%')
    .attr('y1', '0%')
    .attr('x2', '0%')
    .attr('y2', '100%');

  // build the gradient stops
  const stops = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const gradValue = maxVal * (1 - 2 * t);
    const gradColor = color(gradValue);
    stops.push({ offset: `${t * 100}%`, color: gradColor });
  }
  grad.selectAll('stop').data(stops).join('stop')
    .attr('offset', d => d.offset)
    .attr('stop-color', d => d.color);

  const legend = g.selectAll('g.hm-legend').data([null]).join('g')
    .attr('class', 'hm-legend')
    .attr('transform', `translate(${legendX}, 0)`);

  // the coloured bar itself
  legend.selectAll('rect.hm-legend-bar').data([null]).join('rect')
    .attr('class', 'hm-legend-bar')
    .attr('width', legendWidth)
    .attr('height', gridHeight)
    .attr('rx', 3)
    .attr('fill', 'url(#hm-legend-grad)');

  // tick marks next to the bar
  const legendScale = d3.scaleLinear()
    .domain([maxVal, -maxVal])
    .range([0, gridHeight]);
  const legendAxisGroup = legend.selectAll('g.hm-legend-axis').data([null]).join('g')
    .attr('class', 'hm-legend-axis')
    .attr('transform', `translate(${legendWidth}, 0)`);
  const legendAxisFn = d3.axisRight(legendScale)
    .ticks(5)
    .tickFormat(d3.format('.1f'));
  legendAxisGroup.call(legendAxisFn);
  legendAxisGroup.select('.domain').remove();
  legendAxisGroup.selectAll('.tick text').attr('font-size', '10px');

  // legend text labels
  legend.selectAll('text.hm-legend-title').data([null]).join('text')
    .attr('class', 'hm-legend-title')
    .attr('x', legendWidth / 2)
    .attr('y', -16)
    .attr('text-anchor', 'middle')
    .attr('font-size', '10px')
    .attr('font-weight', 600)
    .attr('fill', '#6b7280')
    .text('Net flow');

  legend.selectAll('text.hm-legend-unit').data([null]).join('text')
    .attr('class', 'hm-legend-unit')
    .attr('x', legendWidth / 2)
    .attr('y', -4)
    .attr('text-anchor', 'middle')
    .attr('font-size', '9px')
    .attr('fill', '#9ca3af')
    .text('(per 10K)');

  legend.selectAll('text.hm-legend-inflow').data([null]).join('text')
    .attr('class', 'hm-legend-inflow')
    .attr('x', legendWidth / 2)
    .attr('y', gridHeight + 16)
    .attr('text-anchor', 'middle')
    .attr('font-size', '9px')
    .attr('font-weight', 600)
    .attr('fill', '#2563eb')
    .text('Inflow (+)');

  legend.selectAll('text.hm-legend-outflow').data([null]).join('text')
    .attr('class', 'hm-legend-outflow')
    .attr('x', legendWidth / 2)
    .attr('y', gridHeight + 28)
    .attr('text-anchor', 'middle')
    .attr('font-size', '9px')
    .attr('font-weight', 600)
    .attr('fill', '#ef4444')
    .text('Outflow (\u2212)');
}
