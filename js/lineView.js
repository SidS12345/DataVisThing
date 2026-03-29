// lineView.js
// Renders a line chart showing migration trends across 2015-2019.
// The series shown depend on what's currently selected:
//   - if a country is selected: shows inbound vs outbound for that country
//   - if an income cell is selected: shows the trend for that pair
//   - otherwise: shows the aggregate total across all pairs

import {
  YEARS,
  INCOME_SHORT,
  getFlowValue,
  showTooltip,
  moveTooltip,
  hideTooltip
} from './utils.js';

export function lineView(svg, props) {
  const {
    rawData,
    selectedCountry,
    selectedIncomeCell
  } = props;

  // work out dimensions
  const parent = svg.node().parentNode;
  const parentWidth = parent.clientWidth;
  const width = (parentWidth > 32) ? parentWidth - 32 : 800;
  const height = svg.node().getBoundingClientRect().height || 280;
  svg.attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const margin = { top: 24, right: 210, bottom: 52, left: 76 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // root group and stable sublayers (these persist across updates)
  const g = svg.selectAll('g.line-root').data([null]).join('g')
    .attr('class', 'line-root')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const gridLayer   = g.selectAll('g.grid-layer').data([null]).join('g').attr('class', 'grid-layer');
  const axesLayer   = g.selectAll('g.axes-layer').data([null]).join('g').attr('class', 'axes-layer');
  const labelLayer  = g.selectAll('g.label-layer').data([null]).join('g').attr('class', 'label-layer');
  const seriesLayer = g.selectAll('g.series-layer').data([null]).join('g').attr('class', 'series-layer');
  const legendLayer = g.selectAll('g.legend-layer').data([null]).join('g').attr('class', 'legend-layer');

  // build the series data depending on current selection
  const series = buildSeries(rawData, selectedCountry, selectedIncomeCell);

  // --- scales ---
  // collect all values across all series to find the y range
  const allValues = [];
  series.forEach(s => {
    s.values.forEach(v => {
      allValues.push(v.value);
    });
  });
  const rawMin = d3.min(allValues);
  const rawMax = d3.max(allValues);
  const yMin = Math.min(0, rawMin ?? 0);
  const yMax = rawMax ?? 1;

  const x = d3.scalePoint()
    .domain(YEARS)
    .range([0, innerWidth])
    .padding(0.3);
  const y = d3.scaleLinear()
    .domain([yMin, yMax])
    .nice()
    .range([innerHeight, 0]);

  // --- gridlines ---
  const gridInner = gridLayer.selectAll('g.grid-inner').data([null]).join('g')
    .attr('class', 'grid-inner');
  const gridAxis = d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat('');
  gridInner.call(gridAxis);
  gridInner.select('.domain').remove();
  gridInner.selectAll('.tick line')
    .attr('stroke', '#e5e7eb')
    .attr('stroke-dasharray', '3,3');

  // only show a zero baseline when the data goes negative
  const zeroLineData = (yMin < 0) ? [0] : [];
  gridLayer.selectAll('line.zero-line')
    .data(zeroLineData)
    .join('line')
    .attr('class', 'zero-line')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', y(0))
    .attr('y2', y(0))
    .attr('stroke', '#9ca3af')
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '4,2');

  // --- axes ---
  const xAxisGroup = axesLayer.selectAll('g.x-axis').data([null]).join('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0,${innerHeight})`);
  xAxisGroup.call(d3.axisBottom(x).tickFormat(d3.format('d')));

  const yAxisGroup = axesLayer.selectAll('g.y-axis').data([null]).join('g')
    .attr('class', 'y-axis');
  yAxisGroup.call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.1f')));

  // --- axis labels ---
  labelLayer.selectAll('text.x-label').data([null]).join('text')
    .attr('class', 'x-label axis-label')
    .attr('x', innerWidth / 2)
    .attr('y', innerHeight + 44)
    .attr('text-anchor', 'middle')
    .text('Year');

  labelLayer.selectAll('text.y-label').data([null]).join('text')
    .attr('class', 'y-label axis-label')
    .attr('transform', 'rotate(-90)')
    .attr('x', -innerHeight / 2)
    .attr('y', -62)
    .attr('text-anchor', 'middle')
    .text('Net migration flow (per 10K)');

  // --- line generator ---
  const line = d3.line()
    .x(d => x(d.year))
    .y(d => y(d.value))
    .curve(d3.curveMonotoneX);

  // --- draw series lines (keyed join so they enter/exit when mode changes) ---
  seriesLayer.selectAll('path.series-line')
    .data(series, s => s.key)
    .join('path')
    .attr('class', 'series-line')
    .attr('fill', 'none')
    .attr('stroke', s => s.color)
    .attr('stroke-width', 2.5)
    .attr('stroke-linejoin', 'round')
    .attr('d', s => line(s.values));

  // --- draw data point dots ---
  // flatten all series points into one array so we can join them together
  const dots = [];
  series.forEach(s => {
    s.values.forEach(v => {
      dots.push({
        year: v.year,
        value: v.value,
        color: s.color,
        label: s.label,
        id: s.key + '-' + v.year
      });
    });
  });

  seriesLayer.selectAll('circle.lv-dot')
    .data(dots, d => d.id)
    .join('circle')
    .attr('class', 'lv-dot')
    .attr('cx', d => x(d.year))
    .attr('cy', d => y(d.value))
    .attr('r', 5)
    .attr('fill', d => d.color)
    .attr('stroke', '#fff')
    .attr('stroke-width', 1.5)
    .on('mouseover', function(event, d) {
      d3.select(this).attr('r', 7);
      const formatted = d3.format('+.2f')(d.value);
      const tooltipHtml = `<strong>${d.label}</strong><br/>${d.year}: ${formatted} per 10K`;
      showTooltip(event, tooltipHtml);
    })
    .on('mousemove', function(event) {
      moveTooltip(event);
    })
    .on('mouseout', function() {
      d3.select(this).attr('r', 5);
      hideTooltip();
    });

  // --- legend (rows keyed by series so they update cleanly) ---
  const legendRows = legendLayer.selectAll('g.legend-row')
    .data(series, s => s.key)
    .join('g')
    .attr('class', 'legend-row')
    .attr('transform', (s, i) => `translate(${innerWidth + 20},${i * 26})`);

  legendRows.each(function(s) {
    const row = d3.select(this);

    row.selectAll('line').data([null]).join('line')
      .attr('x1', 0)
      .attr('x2', 20)
      .attr('y1', 8)
      .attr('y2', 8)
      .attr('stroke', s.color)
      .attr('stroke-width', 2.5);

    row.selectAll('circle').data([null]).join('circle')
      .attr('cx', 10)
      .attr('cy', 8)
      .attr('r', 4)
      .attr('fill', s.color)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5);

    row.selectAll('text').data([null]).join('text')
      .attr('x', 26)
      .attr('y', 12)
      .attr('font-size', '11px')
      .attr('fill', '#374151')
      .text(s.label);
  });
}


// builds the array of series depending on what's currently selected
function buildSeries(rawData, country, incomeCell) {
  // country mode: show inbound vs outbound for the selected country
  if (country !== 'all') {
    const inbound = YEARS.map(yr => {
      const incoming = rawData.filter(d => d.target_country_name === country);
      const total = d3.sum(incoming, d => Math.max(0, getFlowValue(d, yr)));
      return { year: yr, value: total };
    });
    const outbound = YEARS.map(yr => {
      const outgoing = rawData.filter(d => d.base_country_name === country);
      const total = d3.sum(outgoing, d => Math.abs(Math.min(0, getFlowValue(d, yr))));
      return { year: yr, value: total };
    });
    return [
      { key: 'inbound', label: `Inbound to ${country}`, color: '#2563eb', values: inbound },
      { key: 'outbound', label: `Outbound from ${country}`, color: '#ef4444', values: outbound }
    ];
  }

  // income pair mode: show the trend for that specific pair
  if (incomeCell) {
    const origin = incomeCell.origin;
    const dest = incomeCell.dest;
    const subset = rawData.filter(d =>
      d.base_country_wb_income === origin && d.target_country_wb_income === dest
    );
    const values = YEARS.map(yr => {
      const total = d3.sum(subset, d => getFlowValue(d, yr));
      return { year: yr, value: total };
    });
    const originLabel = INCOME_SHORT[origin] || origin;
    const destLabel = INCOME_SHORT[dest] || dest;
    return [{
      key: 'income-pair',
      label: `${originLabel} \u2192 ${destLabel}`,
      color: '#2563eb',
      values: values
    }];
  }

  // default: aggregate across everything
  const values = YEARS.map(yr => {
    const total = d3.sum(rawData, d => getFlowValue(d, yr));
    return { year: yr, value: total };
  });
  return [{ key: 'total', label: 'All country pairs', color: '#2563eb', values: values }];
}
