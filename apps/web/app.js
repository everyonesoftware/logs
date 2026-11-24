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
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Unable to load ${url}`);
  return response.json();
}


function investigate({ end, events, metric }) {
  let endTime = metric ? seconds(end) : 0;
  const peakTime = metric && seconds(metric.peakTime);
  const windowStart = metric && seconds(metric.windowStart);
  const windowEnd = metric && seconds(metric.windowEnd);
  const samples = metric ? metric.values.map((value, i) => ({ time: endTime - (metric.values.length - 1 - i) * 60, value })) : [];
  const peak = samples.find(point => point.time === peakTime);
  const ceiling = Math.max(...(metric?.values ?? []), 1);
  let ordered = metric ? [...events].sort((a, b) => seconds(b.time) - seconds(a.time)) : [];
  let scoped = false;
  let selected = null;
  let previousRows;
  let truncated = false;
  const detail = document.querySelector('.detail');
  const rangeStart = () => endTime - 60 * Number($('range').value);

  function updateApps() {
    const select = $('app');
    const active = select.value;
    const apps = [...new Set([...ordered.map(event => event.app), metric?.app, active].filter(Boolean))].sort();
    if (JSON.stringify(apps) === JSON.stringify([...select.options].slice(1).map(option => option.value))) return;
    select.replaceChildren(new Option('All apps', ''), ...apps.map(app => new Option(app, app)));
    select.value = active;
  }
  for (const level of metric ? ['ERROR', 'WARN', 'INFO'] : ['FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE']) $('level').add(new Option(level, level));
  if (metric) {
    const jumpLabel = `Show ${metric.app} logs around ${metric.peakTime} UTC`;
    $('mode').textContent = 'Sample data';
    document.querySelector('.metric').hidden = false;
    $('scope-text').textContent = `Metric window · ${metric.app} · ${clock(windowStart)}–${clock(windowEnd)} UTC`;
    $('metric-app').textContent = metric.app;
    $('metric-label').textContent = `${metric.name} · 1 min buckets`;
    $('peak').setAttribute('aria-label', jumpLabel);
    $('jump').textContent = `${jumpLabel} ↗`;
    updateApps();
  }

  function renderRows() {
    const query = $('q').value.trim().toLowerCase();
    const app = $('app').value;
    const level = $('level').value;
    const start = rangeStart();
    const shown = ordered.filter(event => {
      const time = metric ? seconds(event.time) : Date.parse(event.timestamp) / 1000;
      return time >= start && time <= endTime &&
        (!scoped || (time >= windowStart && time < windowEnd && event.app === metric.app)) &&
        (!app || event.app === app) && (!level || event.level === level) &&
        (!query || [event.message, event.source, event.requestId].some(field => field.toLowerCase().includes(query)));
    });
    if (selected && !shown.some(event => event.id === selected.id)) {
      if (detail.contains(document.activeElement)) $('q').focus();
      selected = null;
      detail.hidden = true;
      $('detail').replaceChildren();
    }
    $('scope').hidden = !scoped;
    const count = `${shown.length} ${shown.length === 1 ? 'event' : 'events'}`;
    if ($('count').textContent !== count) $('count').textContent = count;
    const empty = !metric && ordered.length === 0 ? 'No logs in the last hour.' : truncated
      ? 'No matches among the latest logs.' : 'No events match. Try a broader time range or clear a filter.';
    const rowState = JSON.stringify([shown.map(event => event.id), selected?.id, empty]);
    if (previousRows === rowState) return;
    previousRows = rowState;
    const focused = document.activeElement.dataset.event;
    $('rows').replaceChildren(...shown.map(event => {
      const row = element('button', undefined, 'row');
      row.type = 'button';
      row.dataset.event = event.id;
      row.setAttribute('aria-pressed', String(selected?.id === event.id));
      row.append(element('span', event.time ?? event.timestamp.slice(11, 19), 'time'), element('span', event.level, `sev ${event.level.toLowerCase()}`),
        element('span', event.app, 'app'), element('span', event.message, 'msg'));
      row.addEventListener('click', () => inspect(event));
      return row;
    }));
    if (shown.length === 0) $('rows').append(element('div', empty, 'empty'));
    if (focused) ([...$('rows').children].find(row => row.dataset.event === focused) ?? $('q')).focus({ preventScroll: true });
  }

  function inspect(event) {
    selected = event;
    renderRows();
    const fields = element('dl');
    for (const [label, value] of Object.entries({ Time: event.timestamp ?? `${event.time} UTC`, App: event.app, Source: event.source, 'Request ID': event.requestId })) {
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
    if (!metric) return;
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
    if (!metric) return;
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
    if ($('investigation').hidden || event.defaultPrevented) return;
    if (event.key === 'Escape' && selected) {
      event.preventDefault();
      closeDetail();
    } else if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey &&
      !event.target.closest('input, textarea, select, [contenteditable]')) {
      event.preventDefault();
      $('q').focus();
    }
  });
  function show() {
    $('load').hidden = true;
    $('workspace').hidden = false;
  }
  if (metric) {
    renderRows();
    renderMetric();
    show();
  }
  return snapshot => {
    endTime = Date.parse(snapshot.now) / 1000;
    ordered = snapshot.events;
    truncated = snapshot.truncated;
    updateApps();
    renderRows();
    show();
  };
}

let updateLogs;
function logStatus(message) {
  const status = $('log-status');
  if (status.textContent !== message) status.textContent = message;
  status.hidden = !message;
}
async function poll() {
  try {
    const snapshot = await json('/api/logs');
    if (!updateLogs && snapshot.metric) {
      investigate(snapshot);
      return;
    }
    if (!Array.isArray(snapshot.events) || !Number.isFinite(Date.parse(snapshot.now))) throw new Error('Invalid log snapshot');
    updateLogs ??= investigate(snapshot);
    updateLogs(snapshot);
    logStatus(snapshot.truncated ? `Showing only the latest ${snapshot.limit} logs before filters.` : '');
  } catch {
    if ($('workspace').hidden) $('load').textContent = 'Could not load logs. Retrying…';
    else logStatus('Could not refresh logs. Showing the last update while retrying…');
  }
  setTimeout(poll, 3000);
}
poll();
