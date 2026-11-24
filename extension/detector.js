/* ClickShield v0.2 — local, explanatory risk signals; no form values are accessed. */
'use strict';
(function (root) {
  function analyze(doc, address) {
    const url = new URL(address);
    const text = String(doc.body?.innerText || doc.body?.textContent || '')
      .slice(0, 30000).toLowerCase();
    const evidence = [];
    let score = 0;
    const add = (label, points, id) => {
      evidence.push({ id, label, points });
      score += points;
    };
    const application = /\b(internship|job application|recruitment|scholarship|hiring)\b/i.test(text);
    const fee = /\b(registration fee|application fee|processing fee|pay to apply|non-refundable fee)\b/i.test(text);
    const urgency = /\b(act immediately|only \d+ hours? left|limited slots|hurry now|last chance)\b/i.test(text);
    const fields = [...doc.querySelectorAll('input')].some(input => {
      // Inspect metadata, never .value or any entered form data.
      const description = [input.type, input.name, input.id, input.getAttribute('placeholder')]
        .filter(Boolean).join(' ').toLowerCase();
      return /\b(password|passport|aadhaar|card.?number|credit.?card)\b/i.test(description);
    });
    const local = /^(localhost|127\.0\.0\.1|\[::1\]|.*\.localhost)$/i.test(url.hostname);
    if (url.protocol === 'http:' && !local) add('This webpage uses HTTP rather than HTTPS.', 1, 'http');
    if (url.username || url.password) add('Embedded credentials appear in the URL.', 2, 'credentials');
    if (url.hostname.split('.').some(part => part.startsWith('xn--'))) {
      add('Internationalized domain spelling deserves verification.', 1, 'idn');
    }
    if (application && fee) add('Application-related payment wording detected.', 3, 'fee');
    if (application && urgency) add('Urgency language appears in an application.', 1, 'urgency');
    if (application && fields) add('Sensitive form-field types appear on an application page.', 1, 'sensitive');
    if (!application && fee && fields) add('Payment wording appears alongside sensitive form fields.', 2, 'payment-fields');
    return {
      hostname: url.hostname,
      level: score >= 3 ? 'high' : score >= 1 ? 'caution' : 'low',
      score,
      evidence: evidence.map(({ label }) => label),
      indicators: evidence.map(({ id }) => id),
      // This is a heuristic category, not a probability of fraud.
      assessedAt: new Date().toISOString()
    };
  }
  root.ClickShieldDetector = { analyze };
})(globalThis);
