/** ClickShield Risk Studio — transparent, client-only demo. No network requests. */
'use strict';

const $ = (id) => document.getElementById(id);
const scenarios = Object.freeze({
  job: {
    url: 'https://internship-verify.example/apply',
    text: 'Congratulations! You are shortlisted for an internship. Pay the non-refundable registration fee of ₹899 to confirm your place. Only 2 hours left. Please provide your passport details.'
  },
  scholarship: {
    url: 'http://scholarship-claim.example/award',
    text: 'Your scholarship is approved. Act immediately to claim it! Pay a processing fee first and submit your Aadhaar details to unlock the benefit.'
  },
  normal: {
    url: 'https://university.example/academic-calendar',
    text: 'Welcome to the academic information portal. Browse course offerings, exam timetables, student services and the campus calendar.'
  }
});

const menuToggle = $('menuToggle');
const menu = $('primaryNav');
menuToggle.addEventListener('click', () => {
  const open = menuToggle.getAttribute('aria-expanded') !== 'true';
  menuToggle.setAttribute('aria-expanded', String(open));
  menu.classList.toggle('open', open);
});
menu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  menu.classList.remove('open');
  menuToggle.setAttribute('aria-expanded', 'false');
}));

const form = $('analyzerForm');
const urlInput = $('scenarioUrl');
const textInput = $('scenarioText');
const error = $('formError');
const charCount = $('charCount');
const resultPanel = $('resultPanel');
const resultStatus = $('resultStatus');
const resultHeadline = $('resultHeadline');
const resultDescription = $('resultDescription');
const findingList = $('findingList');
const resultIcon = $('resultIcon');
const resultDot = $('resultDot');
const simulateButton = $('simulateButton');
const resetButton = $('resetButton');
const dialog = $('confirmDialog');
const modalMessage = $('modalMessage');
const toast = $('toast');
let lastResult = null;
let toastTimeout;

function setScenario(key) {
  const choice = scenarios[key];
  urlInput.value = choice.url;
  textInput.value = choice.text;
  updateCount();
  document.querySelectorAll('[data-scenario]').forEach(button => {
    const selected = button.dataset.scenario === key;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  clearResults();
}

function updateCount() {
  charCount.textContent = `${textInput.value.length} / 1600`;
}

function clearResults() {
  lastResult = null;
  error.hidden = true;
  resultPanel.className = 'result-panel';
  resultDot.className = 'result-dot';
  resultIcon.textContent = '✦';
  resultStatus.textContent = 'AWAITING ANALYSIS';
  resultHeadline.textContent = 'A clearer decision starts here.';
  resultDescription.textContent = 'Select a scenario and analyze it to see which defined risk signals appear.';
  findingList.replaceChildren();
  simulateButton.disabled = true;
}

function analyzeScenario(rawUrl, pageText) {
  let url;
  try {
    const value = rawUrl.trim();
    if (!/^https?:\/\//i.test(value)) throw new Error('Add https:// or http:// to the URL.');
    url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.hostname.length > 253) {
      throw new Error('Please enter a valid HTTP or HTTPS URL.');
    }
  } catch (cause) {
    throw new Error(cause.message.startsWith('Add ') ? cause.message : 'Please enter a valid website URL starting with https:// or http://.');
  }

  const text = (pageText || '').slice(0, 1600).toLowerCase();
  const host = url.hostname.toLowerCase();
  const findings = [];
  const add = (detail, weight) => findings.push({ detail, weight });
  const isApplication = /\b(internship|recruitment|job|hiring|scholarship|application|admission|graduate role)\b/i.test(text);
  const mentionsFees = /\b(registration fee|processing fee|application fee|pay to apply|payment to apply|non-refundable fee|pay a fee)\b/i.test(text);
  const urgency = /\b(act immediately|only \d+ (?:hours?|minutes?) left|limited slots|hurry now|apply within \d+ hours?|last chance|urgent response)\b/i.test(text);
  const sensitiveInfo = /\b(passport|aadhaar|otp|one.time password|bank details|bank account|credit card|identity number)\b/i.test(text);

  if (url.protocol === 'http:') add('Page address uses HTTP rather than HTTPS.', 1);
  if (url.username || url.password) add('URL contains embedded login information.', 2);
  if (host.split('.').some(part => part.startsWith('xn--'))) add('Internationalized domain spelling deserves manual verification.', 1);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) add('The website address is a numeric IP rather than a familiar domain.', 1);
  if (isApplication && mentionsFees) add('Application or scholarship message requests a fee.', 3);
  if (isApplication && urgency) add('Urgency language appears alongside an application offer.', 1);
  if (isApplication && sensitiveInfo) add('Application message asks for potentially sensitive information.', 1);
  if (mentionsFees && sensitiveInfo && !isApplication) add('Payment language appears alongside sensitive information requests.', 2);

  const score = findings.reduce((sum, item) => sum + item.weight, 0);
  const level = score >= 3 ? 'high' : score >= 1 ? 'caution' : 'low';
  return { level, findings, host };
}

function showResult(result) {
  lastResult = result;
  resultPanel.className = 'result-panel ' + result.level;
  resultDot.className = 'result-dot ' + result.level;
  const ui = {
    high: { icon: '!', status: 'HIGH CONCERN · REVIEW FIRST', headline: 'Several signals deserve a pause.', description: 'This example combines signals often used in deceptive offers. Verify independently before sharing information or paying.' },
    caution: { icon: '!', status: 'CAUTION · CHECK DETAILS', headline: 'A closer look is worthwhile.', description: 'One or more defined warning signals were found. They are not proof of fraud; seek independent confirmation.' },
    low: { icon: '✓', status: 'NO LISTED SIGNALS FOUND', headline: 'No specific flags found.', description: 'The provided text and URL did not match our limited demo rules. This is not evidence that the website is safe.' }
  }[result.level];
  resultIcon.textContent = ui.icon;
  resultStatus.textContent = ui.status;
  resultHeadline.textContent = ui.headline;
  resultDescription.textContent = ui.description;
  findingList.replaceChildren();
  for (const item of result.findings) {
    const li = document.createElement('li');
    li.textContent = item.detail;
    findingList.appendChild(li);
  }
  simulateButton.disabled = false;
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.hidden = true; }, 4200);
}

function closeDialog() {
  if (dialog.open) dialog.close();
}

for (const button of document.querySelectorAll('[data-scenario]')) {
  button.addEventListener('click', () => setScenario(button.dataset.scenario));
}
textInput.addEventListener('input', () => { updateCount(); clearResults(); });
urlInput.addEventListener('input', clearResults);

form.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const result = analyzeScenario(urlInput.value, textInput.value);
    error.hidden = true;
    showResult(result);
  } catch (cause) {
    clearResults();
    error.textContent = cause.message;
    error.hidden = false;
    urlInput.focus();
  }
});

simulateButton.addEventListener('click', () => {
  if (!lastResult) return;
  if (lastResult.level === 'low') {
    showToast('Demo only: no flagged signals, and no form is actually submitted.');
    return;
  }
  modalMessage.textContent = `This scenario triggered ${lastResult.findings.length} defined warning signal(s). Review the evidence before deciding to continue.`;
  dialog.showModal();
});
$('modalClose').addEventListener('click', closeDialog);
$('modalCancel').addEventListener('click', () => { closeDialog(); showToast('Demo action cancelled. Nothing was submitted.'); });
$('modalProceed').addEventListener('click', () => { closeDialog(); showToast('Demo continued. No real data was submitted.'); });
dialog.addEventListener('click', (event) => { if (event.target === dialog) closeDialog(); });
resetButton.addEventListener('click', () => setScenario('job'));
setScenario('job');
