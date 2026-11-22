'use strict';

const $ = id => document.getElementById(id);
const seconds = time => time.split(':').reduce((total, part) => total * 60 + Number(part), 0) * (time.length === 5 ? 60 : 1);
const clock = time => {
  const minutes = (Math.floor(time / 60) + 1440) % 1440;
  return [Math.floor(minutes / 60), minutes % 60].map(part => String(part).padStart(2, '0')).join(':');
};
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load ${url}`);
  return response.json();
}

const settings = $('settings-dialog');
$('settings').addEventListener('click', () => settings.showModal());
$('check').addEventListener('click', () => {
  $('update-status').textContent = 'Update checks unavailable: no web release channel is configured.';
});
json('/version.json').then(({ version }) => {
  $('current-version').textContent = `Current Version: ${version}`;
}).catch(() => { $('current-version').textContent = 'Current Version: unavailable'; });

function investigate({ end, events, metric }) {
  const endTime = seconds(end);
  const peakTime = seconds(metric.peakTime);
  const windowStart = seconds(metric.windowStart);
  const windowEnd = seconds(metric.windowEnd);
  const samples = metric.values.map((value, i) => ({ time: endTime - (metric.values.length - 1 - i) * 60, value }));
  const peak = samples.find(point => point.time === peakTime);
  const ceiling = Math.max(...metric.values, 1);
  const ordered = [...events].sort((a, b) => seconds(b.time) - seconds(a.time));
  let scoped = false;
  let selected = null;
  const detail = document.querySelector('.detail');
  const rangeStart = () => endTime - 60 * Number($('range').value);
  const jumpLabel = `Show ${metric.app} logs around ${metric.peakTime} UTC`;

  for (const app of [...new Set([...events.map(event => event.app), metric.app])].sort()) $('app').add(new Option(app, app));
  for (const level of ['ERROR', 'WARN', 'INFO']) $('level').add(new Option(level, level));
  $('sample-end').textContent = `Sample timeline ends at ${clock(endTime)} UTC`;
  $('scope-text').textContent = `Metric window · ${metric.app} · ${clock(windowStart)}–${clock(windowEnd)} UTC`;
  $('metric-app').textContent = metric.app;
  $('metric-label').textContent = `${metric.name} · 1 min buckets`;
  $('peak').setAttribute('aria-label', jumpLabel);
  $('jump').textContent = `${jumpLabel} ↗`;

  function renderRows() {
    const query = $('q').value.trim().toLowerCase();
    const app = $('app').value;
    const level = $('level').value;
    const start = rangeStart();
    const shown = ordered.filter(event => {
      const time = seconds(event.time);
      return time >= start && time <= endTime &&
        (!scoped || (time >= windowStart && time < windowEnd && event.app === metric.app)) &&
        (!app || event.app === app) && (!level || event.level === level) &&
        (!query || [event.message, event.source, event.requestId].some(field => field.toLowerCase().includes(query)));
    });
    if (selected && !shown.includes(selected)) {
      selected = null;
      detail.hidden = true;
      $('detail').replaceChildren();
    }
    $('scope').hidden = !scoped;
    $('count').textContent = `${shown.length} ${shown.length === 1 ? 'event' : 'events'}`;
    $('rows').replaceChildren(...shown.map(event => {
      const row = element('button', undefined, 'row');
      row.type = 'button';
      row.dataset.event = event.id;
      row.setAttribute('aria-pressed', String(selected === event));
      row.append(element('span', event.time, 'time'), element('span', event.level, `sev ${event.level.toLowerCase()}`),
        element('span', event.app, 'app'), element('span', event.message, 'msg'));
      row.addEventListener('click', () => inspect(event));
      return row;
    }));
    if (shown.length === 0) $('rows').append(element('div', 'No events match. Try a broader time range or clear a filter.', 'empty'));
  }

  function inspect(event) {
    selected = event;
    renderRows();
    const fields = element('dl');
    for (const [label, value] of Object.entries({ Time: `${event.time} UTC`, App: event.app, Source: event.source, 'Request ID': event.requestId })) {
      fields.append(element('dt', label), element('dd', value));
    }
    $('detail').replaceChildren(element('span', event.level, `sev ${event.level.toLowerCase()}`),
      element('h3', event.message), fields,
      element('pre', JSON.stringify({ source: event.source, requestId: event.requestId }, null, 2)));
    detail.hidden = false;
    $('close').focus();
  }

  function closeDetail() {
    const id = selected?.id;
    selected = null;
    detail.hidden = true;
    $('detail').replaceChildren();
    renderRows();
    ([...$('rows').children].find(row => row.dataset.event === id) || $('q')).focus();
  }

  function renderMetric() {
    const start = rangeStart();
    const hasPeak = peak && peakTime >= start && peakTime <= endTime;
    const x = time => 300 * (time - start) / (endTime - start);
    const y = value => 130 - value / ceiling * 100;
    const visible = samples.filter(point => point.time >= start);
    const [first] = visible;
    const path = visible.map(point => `${x(point.time)} ${y(point.value)}`).join('L');
    $('line').setAttribute('d', first ? `M${path}` : '');
    $('area').setAttribute('d', first ? `M${path}L300 130H${x(first.time)}Z` : '');
    $('guide').setAttribute('d', hasPeak ? `M${x(peakTime)} 24V130` : '');
    if (hasPeak) {
      $('peak').style.left = `${x(peakTime) / 3}%`;
      $('peak').style.top = `${y(peak.value) / 1.4}%`;
    }
    $('peak').hidden = $('jump').hidden = !hasPeak;
    $('outside').hidden = Boolean(hasPeak);
    $('from').textContent = clock(start);
    $('mid').textContent = clock(start + (endTime - start) / 2);
    $('to').textContent = `${clock(endTime)} UTC`;
    $('value').replaceChildren(document.createTextNode(String(samples.at(-1).value)), element('small', ` ${metric.unit}`));
    $('peak-label').textContent = hasPeak ? `Peak ${peak.value}${metric.unit}` : 'Latest sample';
    $('chart').setAttribute('aria-label', `${metric.app} ${metric.name}, ${clock(start)} to ${clock(endTime)} UTC${hasPeak ? `; peak ${peak.value}${metric.unit} at ${metric.peakTime} UTC` : ''}`);
  }

  function jumpToMetric() {
    // A peak at the range boundary can still have correlated logs before that boundary.
    const required = (endTime - windowStart) / 60;
    if (Number($('range').value) < required) {
      $('range').value = [...$('range').options].map(option => Number(option.value)).sort((a, b) => a - b).find(value => value >= required);
    }
    $('app').value = metric.app;
    $('level').value = $('q').value = '';
    scoped = true;
    renderRows();
    renderMetric();
    $('unscope').focus();
  }

  for (const id of ['peak', 'jump']) $(id).addEventListener('click', jumpToMetric);
  $('unscope').addEventListener('click', () => { scoped = false; renderRows(); $('app').focus(); });
  $('close').addEventListener('click', closeDetail);
  $('q').addEventListener('input', renderRows);
  $('level').addEventListener('change', renderRows);
  $('app').addEventListener('change', () => { scoped = false; renderRows(); });
  $('range').addEventListener('change', () => { scoped = false; renderRows(); renderMetric(); });
  $('reset').addEventListener('click', () => {
    $('q').value = $('app').value = $('level').value = '';
    $('range').value = '30';
    scoped = false;
    renderRows();
    renderMetric();
  });
  document.addEventListener('keydown', event => {
    if (settings.open || event.defaultPrevented) return;
    if (event.key === 'Escape' && selected) {
      event.preventDefault();
      closeDetail();
    } else if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey &&
      !event.target.closest('input, textarea, select, [contenteditable]')) {
      event.preventDefault();
      $('q').focus();
    }
  });
  renderRows();
  renderMetric();
  $('load').hidden = true;
  $('workspace').hidden = false;
}

json('/sample.json').then(investigate).catch(() => {
  $('load').textContent = 'Sample data could not be loaded. Reload the page to try again.';
});
