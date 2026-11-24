/* ClickShield v0.2 — opt-in monitoring and best-effort native form interception. */
'use strict';
(() => {
  if (globalThis.__clickShieldStarted) return;
  globalThis.__clickShieldStarted = true;

  let autoEnabled = false;
  let latest = null;
  let scanTimer = null;
  let observer = null;
  let warningHost = null;
  let warningRoot = null;
  let riskBadge = null;
  let dialog = null;
  let pendingSubmission = null;
  let previouslyFocused = null;
  const allowedForms = new WeakSet();

  function inspect() {
    latest = globalThis.ClickShieldDetector.analyze(document, location.href);
    return latest;
  }

  function ensureUI() {
    if (warningHost && warningHost.isConnected) return;
    warningHost = document.createElement('div');
    warningHost.setAttribute('data-clickshield-ui', '');
    warningHost.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    (document.documentElement || document).appendChild(warningHost);
    warningRoot = warningHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      * {box-sizing:border-box} .notice{position:fixed;right:18px;bottom:18px;z-index:1;display:flex;align-items:center;gap:11px;background:#0b1829;color:#f7f8fb;border:1px solid #39506b;border-left:3px solid #ffad79;box-shadow:0 14px 48px #02081380;border-radius:12px;padding:11px 14px;font:12px/1.5 system-ui,sans-serif;max-width:345px;pointer-events:auto}
      .notice strong{font-size:12px}.notice span{color:#a9bbce;font-size:11px}.notice button{background:transparent;color:#ffbf97;border:0;cursor:pointer;font:700 11px system-ui;padding:5px 0 5px 6px;white-space:nowrap}
      .notice button:focus-visible,.dialog button:focus-visible{outline:2px solid #ffad79;outline-offset:3px}
      .backdrop{position:fixed;inset:0;background:#050d19b3;display:grid;place-items:center;z-index:2;pointer-events:auto;padding:18px;font-family:system-ui,sans-serif}
      .dialog{background:linear-gradient(145deg,#122641,#091525);border:1px solid #415974;border-radius:20px;color:#f7f9fc;padding:27px;max-width:430px;width:100%;box-shadow:0 24px 75px #0009}
      .eyebrow{color:#ffbb90;font:700 10px/1.5 system-ui;letter-spacing:1.7px}.icon{display:grid;place-items:center;width:46px;height:46px;border-radius:12px;background:#ffad791e;border:1px solid #ffad795c;color:#ffbc91;font-size:24px;font-weight:bold;margin:14px 0}
      .dialog h2{font:700 23px/1.2 system-ui;letter-spacing:-.6px;margin:10px 0 12px}.dialog p{font:13px/1.65 system-ui;color:#aabfd0;margin:8px 0 13px}
      .evidence{border:1px solid #3b5064;background:#0c1c30;border-radius:10px;padding:11px 14px;margin:15px 0;max-height:170px;overflow:auto;font:12px/1.7 system-ui;color:#dce7f1}
      .evidence li{margin:4px 0}.actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:19px}.actions button{border-radius:9px;padding:11px 14px;font:700 12px system-ui;cursor:pointer}
      .primary{border:0;color:#1a2736;background:#ffb58a}.secondary{color:#dbe6ee;background:transparent;border:1px solid #5c7389}.muted{color:#a6b9cc;background:transparent;border:0;text-decoration:underline}
      .disclaimer{font-size:10px!important;border-top:1px solid #344a60;padding-top:14px;margin-top:18px!important}
      @media(max-width:430px){.dialog{padding:20px}.dialog h2{font-size:20px}.notice{right:10px;bottom:10px;left:10px;max-width:none}}
    `;
    warningRoot.appendChild(style);
  }

  function hideNotice() {
    if (riskBadge) { riskBadge.remove(); riskBadge = null; }
  }

  function showNotice(result) {
    hideNotice();
    if (!autoEnabled || result.level === 'low') return;
    ensureUI();
    const note = document.createElement('div');
    note.className = 'notice';
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = result.level === 'high' ? 'ClickShield · Review recommended' : 'ClickShield · Caution';
    const sub = document.createElement('span');
    sub.textContent = `${result.evidence.length} risk signal(s) · Not a fraud verdict`;
    copy.append(title, document.createElement('br'), sub);
    const details = document.createElement('button');
    details.type = 'button';
    details.textContent = 'Details ↗';
    details.addEventListener('click', () => showDialog(result, false));
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.setAttribute('aria-label', 'Dismiss ClickShield notice');
    dismiss.textContent = '×';
    dismiss.addEventListener('click', hideNotice);
    note.append(copy, details, dismiss);
    warningRoot.append(note);
    riskBadge = note;
  }

  function closeDialog() {
    if (dialog) { dialog.remove(); dialog = null; }
    pendingSubmission = null;
    if (previouslyFocused?.isConnected) previouslyFocused.focus?.();
    previouslyFocused = null;
  }

  function showDialog(result, requiresChoice, form = null, submitter = null) {
    if (dialog) closeDialog();
    ensureUI();
    previouslyFocused = document.activeElement;
    pendingSubmission = requiresChoice && form ? { form, submitter } : null;
    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    const panel = document.createElement('section');
    panel.className = 'dialog';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'ClickShield safety warning');
    const eyebrow = document.createElement('div');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = requiresChoice ? 'PRE-SUBMISSION WARNING' : 'PAGE RISK OVERVIEW';
    const symbol = document.createElement('div');
    symbol.className = 'icon'; symbol.textContent = '!';
    const heading = document.createElement('h2');
    heading.textContent = requiresChoice ? 'Pause before submitting.' : 'Review these warning signs.';
    const description = document.createElement('p');
    description.textContent = requiresChoice
      ? 'This webpage shows potentially concerning patterns. Your submission is paused. Review the evidence before choosing what to do.'
      : 'These findings are indicators, not proof of fraud. Verify independently before sharing information.';
    const evidence = document.createElement('ul');
    evidence.className = 'evidence';
    for (const entry of result.evidence) {
      const item = document.createElement('li'); item.textContent = entry; evidence.append(item);
    }
    const actions = document.createElement('div'); actions.className = 'actions';
    const cancel = document.createElement('button');
    cancel.className = 'primary'; cancel.type = 'button';
    cancel.textContent = requiresChoice ? 'Cancel submission' : 'Close warning';
    cancel.addEventListener('click', () => closeDialog());
    actions.append(cancel);
    if (requiresChoice) {
      const proceed = document.createElement('button');
      proceed.className = 'secondary'; proceed.type = 'button';
      proceed.textContent = 'Proceed anyway';
      proceed.addEventListener('click', () => {
        const submission = pendingSubmission;
        closeDialog();
        if (!submission || !submission.form.isConnected) return;
        // Authorize exactly this re-dispatched native submit event.
        allowedForms.add(submission.form);
        try {
          if (submission.submitter?.isConnected && submission.submitter.form === submission.form) {
            submission.form.requestSubmit(submission.submitter);
          } else {
            submission.form.requestSubmit();
          }
        } finally { allowedForms.delete(submission.form); }
      });
      actions.append(proceed);
    }
    const foot = document.createElement('p');
    foot.className = 'disclaimer';
    foot.textContent = 'ClickShield cannot guarantee safety or intercept every scripted/network submission. Never enter test data that is personal or sensitive.';
    panel.append(eyebrow, symbol, heading, description, evidence, actions, foot);
    backdrop.append(panel);
    warningRoot.append(backdrop);
    dialog = backdrop;
    cancel.focus();
    // Prevent accidental escape from the decision; Escape cancels a paused submission.
    backdrop.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closeDialog(); }
      if (event.key === 'Tab') {
        const buttons = [...panel.querySelectorAll('button')];
        if (!buttons.length) return;
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && warningRoot.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && warningRoot.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
  }

  function rescan() {
    if (!document.body) return null;
    const old = latest;
    const next = inspect();
    if (autoEnabled) {
      const signature = value => value && JSON.stringify([value.level, value.indicators]);
      if (signature(old) !== signature(next)) showNotice(next);
    }
    return next;
  }
  function scheduleScan() {
    if (!autoEnabled) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(rescan, 450);
  }
  function startObserver() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver(mutations => {
      if (!autoEnabled) return;
      // Ignore ClickShield's own warning UI changes.
      if (mutations.every(m => warningHost && (m.target === warningHost || warningHost.contains(m.target)))) return;
      scheduleScan();
    });
    observer.observe(document.documentElement, { childList:true, subtree:true, characterData:true });
  }

  // Captures native form submit events, not fetch(), XHR or form.submit() bypasses.
  document.addEventListener('submit', event => {
    if (!autoEnabled || !event.target || event.target.tagName !== 'FORM') return;
    const form = event.target;
    if (allowedForms.has(form)) return;
    const result = inspect();
    if (result.level !== 'high') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showDialog(result, true, form, event.submitter || null);
    // Only safe event metadata. Never save or send field values.
    chrome.storage.local.get({interventions:0}).then(({interventions}) => {
      chrome.storage.local.set({interventions: Math.min(9999, interventions + 1)});
    }).catch(() => {});
  }, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !['CLICKSHIELD_SCAN_NOW', 'CLICKSHIELD_GET_STATUS'].includes(message.type)) return;
    try {
      const result = inspect();
      sendResponse({ok:true, finding:result, autoEnabled});
    } catch (error) {
      sendResponse({ok:false, error:String(error.message || error)});
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.autoProtectionEnabled) return;
    autoEnabled = changes.autoProtectionEnabled.newValue === true;
    if (!autoEnabled) { hideNotice(); if (dialog) closeDialog(); }
    else scheduleScan();
  });

  chrome.storage.local.get({autoProtectionEnabled:false}).then(settings => {
    autoEnabled = settings.autoProtectionEnabled === true;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { startObserver(); if (autoEnabled) scheduleScan(); }, {once:true});
    } else { startObserver(); if (autoEnabled) scheduleScan(); }
  }).catch(() => {});
})();
