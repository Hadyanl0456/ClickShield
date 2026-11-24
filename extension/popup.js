'use strict';

const $ = (id) => document.getElementById(id);
const siteName = $('siteName');
const toggle = $('scanToggle');
const scanButton = $('scanButton');
const riskBadge = $('riskBadge');
const riskIcon = $('riskIcon');
const riskTitle = $('riskTitle');
const riskDescription = $('riskDescription');
const signalsList = $('signals');
const scanMeta = $('scanMeta');
const scanCount = $('scanCount');
const aiButton = $('aiButton');
const aiAnswer = $('aiAnswer');
let currentFinding = null;
const BACKEND_ENDPOINT = 'http://127.0.0.1:8765/api/explain';
let currentTab;

function showStatus(level, title, explanation, evidence = []) {
  riskBadge.className = 'badge ' + level;
  riskBadge.textContent = ({neutral:'NOT SCANNED', low:'NO LISTED FLAGS', caution:'REVIEW ADVISED', high:'HIGH CONCERN'})[level];
  riskIcon.textContent = level === 'low' ? '✓' : level === 'neutral' ? '✦' : '!';
  riskTitle.textContent = title;
  riskDescription.textContent = explanation;
  signalsList.replaceChildren();
  for (const detail of evidence) {
    const item = document.createElement('li');
    item.textContent = detail;
    signalsList.append(item);
  }
  signalsList.hidden = !evidence.length;
}

function isSupportedTab(tab) {
  return !!(tab && Number.isInteger(tab.id) && /^https?:\/\//i.test(tab.url || ''));
}

function renderFinding(finding) {
  currentFinding = finding;
  aiAnswer.textContent = 'Optional: send only detected signal categories to the local AI backend.';
  aiButton.disabled = !finding || !Array.isArray(finding.indicators) || finding.indicators.length === 0;
  const descriptions = {
    low:['No listed signals found', 'Our limited rules did not identify a matching warning pattern. This is not a guarantee of safety.'],
    caution:['A closer look is worthwhile', 'Some signals merit further review. A warning is not proof of fraud.'],
    high:['Pause before proceeding', 'Multiple or high-severity signals were detected. Verify the page independently.']
  };
  if (!finding || !descriptions[finding.level]) return;
  showStatus(finding.level, ...descriptions[finding.level], finding.evidence || []);
  scanMeta.textContent = 'Assessed: ' + new Date(finding.assessedAt || Date.now()).toLocaleTimeString();
}

async function messageContentScript(type) {
  if (!isSupportedTab(currentTab)) throw new Error('This browser page cannot be scanned.');
  try {
    const result = await chrome.tabs.sendMessage(currentTab.id, {type});
    if (!result?.ok) throw new Error(result?.error || 'Scan did not finish.');
    return result.finding;
  } catch (error) {
    throw new Error('Refresh this website after updating ClickShield, then try again. Chrome also restricts some pages.');
  }
}

async function initialize() {
  try {
    const saved = await chrome.storage.local.get({autoProtectionEnabled:false, scanHistory:[]});
    toggle.checked = saved.autoProtectionEnabled;
    scanCount.textContent = saved.scanHistory.length;
    const tabs = await chrome.tabs.query({active:true,currentWindow:true});
    currentTab = tabs[0];
    siteName.textContent = isSupportedTab(currentTab) ? new URL(currentTab.url).hostname : 'Unsupported browser page';
    scanButton.disabled = !isSupportedTab(currentTab);
    if (!isSupportedTab(currentTab)) {
      showStatus('neutral', 'Unavailable on this page', 'Open a regular HTTP(S) webpage to scan it.');
    } else if (saved.autoProtectionEnabled) {
      // Read real current-page status without adding to manual scan history.
      try { renderFinding(await messageContentScript('CLICKSHIELD_GET_STATUS')); }
      catch (error) { scanMeta.textContent = error.message; }
    }
  } catch (error) {
    siteName.textContent = 'Current tab unavailable';
    scanButton.disabled = true;
    scanMeta.textContent = String(error.message || error);
  }
}

toggle.addEventListener('change', async () => {
  try {
    await chrome.storage.local.set({autoProtectionEnabled:toggle.checked});
    if (isSupportedTab(currentTab) && toggle.checked) {
      renderFinding(await messageContentScript('CLICKSHIELD_GET_STATUS'));
      scanMeta.textContent = 'Auto protection enabled · Scans run on page updates';
    } else if (!toggle.checked) {
      showStatus('neutral', 'Automatic protection paused', 'Manual scanning is still available using the button below.');
      scanMeta.textContent = 'Auto protection is off';
    }
  } catch (error) { scanMeta.textContent = String(error.message || error); }
});

scanButton.addEventListener('click', async () => {
  if (!isSupportedTab(currentTab)) return;
  scanButton.disabled = true;
  scanButton.textContent = 'Analyzing current webpage...';
  try {
    const finding = await messageContentScript('CLICKSHIELD_SCAN_NOW');
    renderFinding(finding);
    const old = await chrome.storage.local.get({scanHistory:[]});
    const history = [{hostname:finding.hostname,level:finding.level,count:finding.evidence.length,time:new Date().toISOString()},...old.scanHistory].slice(0,10);
    await chrome.storage.local.set({scanHistory:history});
    scanCount.textContent = history.length;
    scanMeta.textContent = 'Last manual scan: ' + new Date().toLocaleTimeString();
  } catch (error) {
    showStatus('neutral', 'Unable to scan page', 'Chrome may restrict this page. If ClickShield was just updated, refresh the webpage.');
    scanMeta.textContent = String(error.message || error);
  } finally {
    scanButton.disabled = !isSupportedTab(currentTab);
    scanButton.innerHTML = '<span>Scan this page</span><span>↗</span>';
  }
});

initialize();

// AI runs ONLY on explicit user click, never on page load or automatic scans.
aiButton.addEventListener('click', async () => {
  if (!currentFinding?.indicators?.length) return;
  aiButton.disabled = true;
  aiButton.textContent = 'Requesting explanation...';
  aiAnswer.textContent = 'Contacting local ClickShield backend...';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 28000);
  try {
    // Only predefined indicator IDs and broad level are sent. No URL,
    // hostname, page text, input fields, passwords or cookies are sent.
    const response = await fetch(BACKEND_ENDPOINT, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({level:currentFinding.level, indicators:currentFinding.indicators}),
      signal: controller.signal
    });
    let data = {};
    try { data = await response.json(); } catch (_) { /* show generic backend error */ }
    if (!response.ok || !data.explanation) {
      throw new Error(data.error || 'Gemini explanation unavailable.');
    }
    aiAnswer.textContent = data.explanation + '\n\nAI guidance is advisory and cannot confirm whether a site is safe.';
  } catch (error) {
    const reason = error.name === 'AbortError' ? 'The AI request timed out.' : error.message;
    aiAnswer.textContent = reason + '\nLocal risk detection and pre-submission protection continue to work without AI.';
  } finally {
    clearTimeout(timeout);
    aiButton.textContent = 'Explain detected warning signs ↗';
    aiButton.disabled = !currentFinding?.indicators?.length;
  }
});
