'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const panel = $('settings-overview'), nav = $('settings'), dialog = $('key-dialog');
  const unlock = $('unlock-keys'), adminInput = $('admin-token'), list = $('keys-list');
  const create = $('new-key'), refresh = $('refresh-keys'), status = $('keys-status');
  const name = $('key-name'), secret = $('key-secret'), submit = $('submit-key'), cancel = $('cancel-key');
  const feedback = $('key-feedback');
  let credential = '', rows = [], view = 0, loading = false, saving = false, needsRefresh = false, action, origin;

  async function request(path, options = {}, token = credential) {
    const response = await fetch(path, {
      ...options, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000),
      headers: { ...options.headers, ...(token && { Authorization: `Bearer ${token}` }) },
    });
    if (!response.ok) throw Object.assign(new Error('Request failed'), { status: response.status });
    return response.json();
  }

  function text(tag, value, className) {
    const el = document.createElement(tag);
    el.textContent = value;
    if (className) el.className = className;
    return el;
  }

  function draw() {
    create.hidden = !credential || loading || needsRefresh;
    refresh.hidden = !credential || loading;
    list.hidden = !credential || loading || needsRefresh || rows.length === 0;
    list.replaceChildren();
    if (list.hidden) return;
    for (const key of rows) {
      const row = text('li', '', 'key-row');
      const identity = text('div', '');
      identity.append(text('strong', key.name), text('code', `${key.prefix}…`));
      row.append(identity, text('span', `Last used: ${key.lastUsedAt ? `${key.lastUsedAt.slice(0, 16).replace('T', ' ')} UTC` : 'Never'}`, 'small'));
      if (key.revokedAt) row.append(text('span', 'Revoked', 'key-revoked'));
      else {
        const button = text('button', 'Revoke');
        button.setAttribute('aria-label', `Revoke ${key.name}`);
        button.addEventListener('click', () => openDialog(key, button));
        row.append(button);
      }
      list.append(row);
    }
  }

  function lock() {
    credential = '';
    needsRefresh = false;
    adminInput.value = '';
    rows = [];
    draw();
  }

  async function overview() {
    const current = view;
    status.textContent = 'Loading API key settings…';
    unlock.hidden = true;
    try {
      const data = await request('/version.json', {}, '');
      if (current !== view) return;
      $('current-version').textContent = `Current Version: ${typeof data.version === 'string' ? data.version : 'unavailable'}`;
      if (!isSecureContext) status.textContent = 'Open Logs over HTTPS to manage API keys.';
      else if (!data.keysConfigured) status.textContent = 'API key management is not configured on this server.';
      else {
        unlock.hidden = false;
        status.textContent = 'Unlock to manage sender keys.';
      }
    } catch {
      if (current === view) {
        $('current-version').textContent = 'Current Version: unavailable';
        status.textContent = 'Could not load Settings. Return to logs and reopen Settings to try again.';
      }
    }
  }

  async function loadKeys(token) {
    if (loading || saving || !token) return;
    const current = view;
    loading = true;
    unlock.querySelector('button').disabled = true;
    status.textContent = 'Loading API keys…';
    draw();
    try {
      const result = await request('/api/keys', {}, token);
      if (current !== view) return;
      credential = token;
      rows = result.keys;
      needsRefresh = false;
      unlock.hidden = true;
      status.textContent = rows.length ? '' : 'No API keys yet.';
    } catch (error) {
      if (current !== view) return;
      if (error.status === 401) {
        lock();
        unlock.hidden = false;
        status.textContent = 'Administrator token was not accepted.';
      } else status.textContent = 'Could not load API keys. Try again.';
    } finally {
      if (current === view) {
        loading = false;
        unlock.querySelector('button').disabled = false;
        draw();
        if (document.activeElement === document.body) (credential ? create : adminInput).focus();
      }
    }
  }

  function navigate(open) {
    if (saving || dialog.open) return;
    view++;
    loading = false;
    lock();
    unlock.querySelector('button').disabled = false;
    panel.hidden = !open;
    $('investigation').hidden = open;
    nav.textContent = open ? 'Back to logs' : 'Settings';
    document.title = open ? 'Logs — Settings' : 'Logs — Investigate';
    if (open) {
      $('current-version').textContent = 'Current Version: loading…';
      panel.scrollTop = 0;
      $('settings-heading').focus();
      void overview();
    } else nav.focus();
  }

  function openDialog(key, button) {
    if (!credential || loading || saving || needsRefresh) return;
    origin = button;
    action = key || null;
    const revoking = Boolean(key);
    $('key-dialog-title').textContent = revoking ? 'Revoke API key?' : 'Create API key';
    $('key-dialog-description').textContent = revoking ? `“${key.name}” will no longer be able to send logs using this key. Existing logs will remain.` : 'Permission: Send logs only';
    $('key-name-field').hidden = revoking;
    name.disabled = revoking;
    name.value = '';
    name.setCustomValidity('');
    feedback.textContent = '';
    cancel.textContent = 'Cancel';
    submit.hidden = false;
    submit.classList.toggle('danger', revoking);
    submit.textContent = revoking ? 'Revoke key' : 'Create API key';
    dialog.showModal();
    (revoking ? cancel : name).focus();
  }

  function reveal(value) {
    $('key-dialog-title').textContent = 'API key created';
    $('key-dialog-description').textContent = 'Copy this key now. This is the only time the full key is shown.';
    $('key-name-field').hidden = true;
    name.disabled = true;
    $('key-reveal').hidden = false;
    secret.value = value;
    submit.hidden = true;
    cancel.textContent = 'Done';
  }

  function forgetReveal() {
    secret.value = '';
    $('key-reveal').hidden = true;
  }

  nav.addEventListener('click', () => navigate(panel.hidden));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden && !dialog.open) {
      event.preventDefault();
      navigate(false);
    }
  });
  unlock.addEventListener('submit', event => {
    event.preventDefault();
    const token = adminInput.value;
    adminInput.value = '';
    if (/^[A-Za-z0-9_-]{32,256}$/.test(token)) void loadKeys(token);
    else status.textContent = 'Enter a valid administrator token.';
  });
  refresh.addEventListener('click', () => void loadKeys(credential));
  create.addEventListener('click', () => openDialog(null, create));
  name.addEventListener('input', () => name.setCustomValidity(''));
  cancel.addEventListener('click', () => { if (!saving) { forgetReveal(); dialog.close(); } });
  dialog.addEventListener('cancel', event => {
    if (saving) event.preventDefault();
    else forgetReveal();
  });
  dialog.addEventListener('close', () => {
    forgetReveal();
    if (!panel.hidden && origin?.isConnected && !origin.hidden) origin.focus();
    else if (credential && !panel.hidden) create.focus();
  });
  $('copy-key').addEventListener('click', async () => {
    const value = secret.value;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      if (secret.value === value) feedback.textContent = 'Key copied.';
    } catch {
      if (secret.value !== value) return;
      secret.select();
      feedback.textContent = 'Key selected. Use your browser’s copy command.';
    }
  });
  $('key-action').addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !credential || submit.hidden) return;
    const label = name.value.trim();
    if (!action && (!label || /[\u0000-\u001f\u007f]/.test(label))) {
      name.setCustomValidity('Enter an application name.');
      name.reportValidity();
      return;
    }
    saving = true;
    submit.disabled = cancel.disabled = true;
    feedback.textContent = action ? 'Revoking key…' : 'Creating key…';
    try {
      const result = action
        ? await request(`/api/keys/${action.id}`, { method: 'DELETE' })
        : await request('/api/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: label }) });
      if (action) {
        rows = rows.map(row => row.id === result.key.id ? result.key : row);
        status.textContent = 'API key revoked.';
        dialog.close();
      } else {
        rows = [result.key, ...rows];
        status.textContent = '';
        reveal(result.secret);
        $('copy-key').focus();
      }
      draw();
      feedback.textContent = '';
    } catch (error) {
      if (error.status === 401) {
        lock();
        unlock.hidden = false;
        status.textContent = 'Administrator token was not accepted. Unlock again.';
      } else if (error.status === 400) {
        feedback.textContent = 'Enter a valid application name.';
        return;
      } else {
        // The server may have committed before the response was lost. Don't retry a create blindly.
        needsRefresh = true;
        draw();
        status.textContent = 'Could not confirm the change. Refresh keys before trying again. If a new key is listed but you did not receive its secret, revoke it and create a replacement.';
      }
      dialog.close();
      (credential ? refresh : adminInput).focus();
    } finally {
      saving = false;
      submit.disabled = cancel.disabled = false;
    }
  });
})();
