// Live check of the link shorteners (needs internet). Run: npm run test:short
const assert = require('node:assert/strict');
const sections = require('../api/sections.js');

(async () => {
  const target = 'https://example-panel.vercel.app/s/emi-vip-' + Date.now().toString(36);
  const t0 = Date.now();
  const short = await sections.shorten(target);
  assert.match(short, /^https:\/\//, 'got a short link');
  const r = await fetch(short, { redirect: 'manual' });
  assert.ok(r.status >= 300 && r.status < 400, 'short link redirects (status ' + r.status + ')');
  assert.equal(r.headers.get('location'), target, 'short link points to the sub link');
  console.log('PASS: shortener ->', short, 'redirects to', target, `(${Date.now() - t0} ms)`);
})().catch(e => { console.error('FAIL:', e.message); process.exitCode = 1; });
