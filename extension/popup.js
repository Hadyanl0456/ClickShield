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
