// barView.js
// Renders a horizontal bar chart showing the top 10 destination countries
// by total inbound migration flow for the current filters and year.

import {
  groupTopDestinations,
  showTooltip,
  moveTooltip,
  hideTooltip
} from './utils.js';

export function barView(svg, props) {
  const { 
    data, 
    year, 
    hover, 
    onHover 
  } = props;

  // work out dimensions from the parent container
  const parent = svg.node().parentNode;
  const parentWidth = parent.clientWidth;
  const width = (parentWidth > 32) ? parentWidth - 32 : 400;
  const height = svg.node().getBoundingClientRect().height || 400;
  svg.attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const margin = { top: 20, right: 20, bottom: 44, left: 140 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // root group
  const g = svg.selectAll('g.bar-root').data([null]).join('g')
    .attr('class', 'bar-root')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // get the top 10 destinations sorted by total flow
  const top10 = groupTopDestinations(data, year, 10);

  // we need income levels for hover events so the heatmap can cross-highlight
  const incomeLookup = new Map();
  data.forEach(d => {
    if (!incomeLookup.has(d.base_country_name)) {
      incomeLookup.set(d.base_country_name, d.base_country_wb_income);
    }
    if (!incomeLookup.has(d.target_country_name)) {
      incomeLookup.set(d.target_country_name, d.target_country_wb_income);
    }
  });

  // --- scales ---
  const maxTotal = d3.max(top10, d => d.total);
  const xDomainMax = maxTotal || 1;

  const x = d3.scaleLinear()
    .domain([0, xDomainMax])
    .nice()
    .range([0, innerWidth]);

  const y = d3.scaleBand()
    .domain(top10.map(d => d.country))
    .range([0, innerHeight])
    .padding(0.15);

  // --- axes ---
  g.selectAll('g.y-axis').data([null]).join('g')
    .attr('class', 'y-axis')
    .call(d3.axisLeft(y));

  g.selectAll('g.x-axis').data([null]).join('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(5));

  // --- bars with enter/update/exit transitions ---
  g.selectAll('rect.bar')
    .data(top10, d => d.country)
    .join(
      enter => enter.append('rect')
        .attr('class', 'bar')
        .attr('x', 0)
        .attr('y', d => y(d.country))
        .attr('width', 0)
        .attr('height', y.bandwidth())
        .call(en => en.transition('enter').duration(400)
          .delay((_, i) => i * 30)
          .attr('width', d => x(d.total))),
      update => update.call(up => {
        up.attr('y', d => y(d.country))
          .attr('height', y.bandwidth());
        up.transition('update').duration(300)
          .attr('width', d => x(d.total));
      }),
      exit => exit.call(ex =>
        ex.transition().duration(200).attr('width', 0).remove()
      )
    )
    .on('mouseover', function(event, d) {
      d3.select(this).classed('active', true);
      const tooltipHtml = `<strong>${d.country}</strong><br/>Total: ${d.total.toFixed(2)} per 10K`;
      showTooltip(event, tooltipHtml);
      if (onHover) {
        const income = incomeLookup.get(d.country);
        onHover({ type: 'country', name: d.country, income: income });
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
    // cross-view highlight: dim bars that don't match the current hover
    .style('opacity', d => {
      if (!hover) return 1;
      if (hover.type === 'country') {
        if (d.country === hover.name) return 1;
        return 0.15;
      }
      if (hover.type === 'flow') {
        if (d.country === hover.target) return 1;
        return 0.15;
      }
      return 1;
    });

  // --- x-axis label ---
  g.selectAll('text.x-label').data([null]).join('text')
    .attr('class', 'x-label axis-label')
    .attr('x', innerWidth / 2)
    .attr('y', innerHeight + 36)
    .attr('text-anchor', 'middle')
    .text('Total migration flow (per 10K)');
}
