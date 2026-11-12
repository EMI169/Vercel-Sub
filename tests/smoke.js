const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { getSupabaseConfig } = require('../lib/supabase');
const R = require('../lib/sub-rules');

const root = path.resolve(__dirname, '..');

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForServer(proc, baseUrl, output) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Local test server exited early: ${output()}`);
    }
    try {
      const response = await fetch(baseUrl + '/api/health');
      if (response.status === 200) return;
    } catch {}
    await pause(80);
  }
  throw new Error(`Local test server did not become ready: ${output()}`);
}

async function post(baseUrl, route, body) {
  const response = await fetch(baseUrl + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function mock(baseUrl, method, query, body) {
  const r = await fetch(baseUrl + '/__mock/rest/v1/' + query, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

function rulesTests() {
  // Custom link names
  assert.equal(R.slugError('emi-vip'), null);
  assert.equal(R.slugError('ab'), 'slug_len');
  assert.equal(R.slugError('a'.repeat(33)), 'slug_len');
  assert.equal(R.slugError('Emi VIP'), 'slug_chars');
  assert.equal(R.slugError('-emi'), 'slug_chars');
  assert.equal(R.slugError('0123456789abcdef'), 'slug_chars'); // looks like a random key
  assert.equal(R.slugError('api'), 'slug_taken');
  assert.equal(R.normSlug('  Emi_Sub '), 'emi_sub');
  // Expiry days: whole number 0..3650, 0 = unlimited
  assert.equal(R.parseDays(30), 30);
  assert.equal(R.parseDays('90'), 90);
  assert.equal(R.parseDays(0), 0);
  assert.equal(R.parseDays(3650), 3650);
  assert.equal(R.parseDays(3651), null);
  assert.equal(R.parseDays(-1), null);
  assert.equal(R.parseDays(1.5), null);
  assert.equal(R.parseDays(''), null);
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(R.expiryFromDays(30, now), '2026-01-31T00:00:00.000Z');
  assert.equal(R.expiryFromDays(0, now), null);
  assert.equal(R.isExpired('2026-01-31T00:00:00.000Z', Date.parse('2026-01-30T23:59:59Z')), false);
  assert.equal(R.isExpired('2026-01-31T00:00:00.000Z', Date.parse('2026-01-31T00:00:00Z')), true);
  assert.equal(R.isExpired(null, now), false);
  assert.equal(R.daysLeft('2026-01-31T00:00:00.000Z', now), 30);
}

async function run() {
  rulesTests();

  const roleKey = getSupabaseConfig({
    SUPABASE_URL: ' https://example.supabase.co/ ',
    SUPABASE_SERVICE_ROLE_KEY: 'test-role',
  });
  assert.equal(roleKey.ok, true);
  assert.equal(roleKey.url, 'https://example.supabase.co');
  assert.equal(roleKey.keyName, 'SUPABASE_SERVICE_ROLE_KEY');

  const legacyKey = getSupabaseConfig({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_KEY: 'test-legacy',
  });
  assert.equal(legacyKey.ok, true);
  assert.equal(legacyKey.keyName, 'SUPABASE_SERVICE_KEY');

  const secretKey = getSupabaseConfig({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SECRET_KEY: 'test-secret',
  });
  assert.equal(secretKey.ok, true);
  assert.equal(secretKey.keyName, 'SUPABASE_SECRET_KEY');

  const missing = getSupabaseConfig({});
  assert.equal(missing.ok, false);
  assert.equal(missing.missing.length, 2);

  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['dev-run.js', String(port)], {
    cwd: root,
    env: { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { logs += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { logs += chunk; });

  try {
    await waitForServer(child, baseUrl, () => logs);
    const page = await fetch(baseUrl + '/');
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /class="auth-orbit"/);
    assert.match(html, /class="orbit-ring orbit-a"/);
    assert.match(html, /id="xTitle"/);

    const health = await fetch(baseUrl + '/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, supabase: 'connected' });

    const firstLogin = await post(baseUrl, '/api/auth', {
      action: 'login', u: 'admin', p: 'admin',
    });
    assert.equal(firstLogin.status, 200);
    assert.equal(firstLogin.body.mustSetup, true);
    // The default-password session can only be used to set the password
    const blocked = await post(baseUrl, '/api/sections', { action: 'list', s: firstLogin.body.s });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.e, 'setup');

    const setup = await post(baseUrl, '/api/auth', {
      action: 'setup',
      s: firstLogin.body.s,
      p1: 'SmokeTest42',
      p2: 'SmokeTest42',
    });
    assert.equal(setup.status, 200);
    assert.equal(setup.body.ok, true);

    const login = await post(baseUrl, '/api/auth', {
      action: 'login', u: 'admin', p: 'SmokeTest42',
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.ok, true);
    const adminRow = (await mock(baseUrl, 'GET', 'users?username=eq.admin'))[0];
    assert.match(adminRow.pass_hash, /^s2:[a-f0-9]{64}$/, 'new passwords use scrypt');
    const wrong = await post(baseUrl, '/api/auth', { action: 'login', u: 'admin', p: 'WrongPass1' });
    assert.equal(wrong.status, 401);

    // Old SHA-256 accounts still log in and are upgraded to scrypt
    const salt = 'abcd1234';
    await mock(baseUrl, 'POST', 'users', { username: 'olduser', role: 'user', salt,
      pass_hash: crypto.createHash('sha256').update(salt + '\u0000' + 'OldPass99').digest('hex') });
    const oldLogin = await post(baseUrl, '/api/auth', { action: 'login', u: 'olduser', p: 'OldPass99' });
    assert.equal(oldLogin.status, 200);
    assert.match((await mock(baseUrl, 'GET', 'users?username=eq.olduser'))[0].pass_hash, /^s2:/);
    assert.equal((await post(baseUrl, '/api/auth', { action: 'login', u: 'olduser', p: 'OldPass99' })).status, 200);
    const oldId = (await mock(baseUrl, 'GET', 'users?username=eq.olduser'))[0].id;
    await mock(baseUrl, 'DELETE', 'users?id=eq.' + oldId);

    const created = await post(baseUrl, '/api/sections', {
      action: 'create', s: login.body.s, title: 'Smoke test section',
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.ok, true);
    assert.ok(created.body.sec && created.body.sec.id);

    const saved = await post(baseUrl, '/api/sections', {
      action: 'save',
      s: login.body.s,
      id: created.body.sec.id,
      title: 'Saved smoke section',
      content: 'line one\nline two',
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.ok, true);

    const fetched = await post(baseUrl, '/api/sections', {
      action: 'get', s: login.body.s, id: created.body.sec.id,
    });
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.sec.title, 'Saved smoke section');
    assert.equal(fetched.body.sec.content, 'line one\nline two');

    const key = await post(baseUrl, '/api/sections', {
      action: 'key', s: login.body.s, id: created.body.sec.id,
    });
    assert.equal(key.status, 200);
    assert.match(key.body.key, /^[a-f0-9]{16}$/);

    const sub = await fetch(baseUrl + '/s/' + key.body.key, {
      headers: { Accept: 'text/plain' },
    });
    assert.equal(sub.status, 200);
    assert.equal(Buffer.from(await sub.text(), 'base64').toString('utf8'), 'line one\nline two');

    // Profile name in apps = section title
    assert.equal(sub.headers.get('profile-title'), 'base64:' + Buffer.from('Saved smoke section').toString('base64'));

    const sid = created.body.sec.id, tok = login.body.s;

    // Custom link name
    const badSlug = await post(baseUrl, '/api/sections', { action: 'link', s: tok, id: sid, slug: 'a b' });
    assert.equal(badSlug.status, 400);
    assert.equal(badSlug.body.e, 'slug_chars');
    const slugSet = await post(baseUrl, '/api/sections', { action: 'link', s: tok, id: sid, slug: 'Emi-VIP' });
    assert.equal(slugSet.status, 200);
    assert.equal(slugSet.body.slug, 'emi-vip');
    assert.equal(slugSet.body.key, key.body.key, 'setting a name keeps the private address');
    const bySlug = await fetch(baseUrl + '/s/emi-vip', { headers: { Accept: 'text/plain' } });
    assert.equal(bySlug.status, 200);
    assert.equal(Buffer.from(await bySlug.text(), 'base64').toString('utf8'), 'line one\nline two');
    const byKeyStill = await fetch(baseUrl + '/s/' + key.body.key, { headers: { Accept: 'text/plain' } });
    assert.equal(byKeyStill.status, 200);

    const other = await post(baseUrl, '/api/sections', { action: 'create', s: tok, title: 'Other' });
    const taken = await post(baseUrl, '/api/sections', { action: 'link', s: tok, id: other.body.sec.id, slug: 'emi-vip' });
    assert.equal(taken.status, 409);
    assert.equal(taken.body.e, 'slug_taken');
    // A name alone is enough for a working link
    const named = await post(baseUrl, '/api/sections', { action: 'link', s: tok, id: other.body.sec.id, slug: 'other_sub' });
    assert.equal(named.status, 200);
    assert.match(named.body.key, /^[a-f0-9]{16}$/);
    await post(baseUrl, '/api/sections', { action: 'del', s: tok, id: other.body.sec.id });

    // Expiry: 30 days, 90 days, custom, unlimited, invalid
    const t0 = Date.now();
    const e30 = await post(baseUrl, '/api/sections', { action: 'expire', s: tok, id: sid, days: 30 });
    assert.equal(e30.status, 200);
    const left30 = (Date.parse(e30.body.expires_at) - t0) / 86400000;
    assert.ok(left30 > 29.99 && left30 < 30.01, 'expires about 30 days from now');
    const e90 = await post(baseUrl, '/api/sections', { action: 'expire', s: tok, id: sid, days: '90' });
    assert.ok(Math.abs((Date.parse(e90.body.expires_at) - t0) / 86400000 - 90) < 0.01);
    const eBad = await post(baseUrl, '/api/sections', { action: 'expire', s: tok, id: sid, days: 4000 });
    assert.equal(eBad.status, 400);
    assert.equal(eBad.body.e, 'days');
    const active = await fetch(baseUrl + '/s/emi-vip', { headers: { Accept: 'text/plain' } });
    assert.equal(active.status, 200);
    assert.match(active.headers.get('subscription-userinfo') || '', /expire=\d+/);

    // Push the expiry into the past -> link stops serving configs
    await mock(baseUrl, 'PATCH', 'sections?id=eq.' + sid, { expires_at: new Date(Date.now() - 1000).toISOString() });
    const dead = await fetch(baseUrl + '/s/emi-vip', { headers: { Accept: 'text/plain' } });
    assert.equal(dead.status, 200);
    const deadTxt = Buffer.from(await dead.text(), 'base64').toString('utf8');
    assert.ok(!deadTxt.includes('line one'), 'expired link must not return the configs');
    assert.match(deadTxt, /Subscription%20expired/);
    const deadKey = await fetch(baseUrl + '/s/' + key.body.key, { headers: { Accept: 'text/plain' } });
    assert.ok(!Buffer.from(await deadKey.text(), 'base64').toString('utf8').includes('line one'));
    const deadHtml = await fetch(baseUrl + '/s/emi-vip', { headers: { Accept: 'text/html' } });
    assert.equal(deadHtml.status, 410);

    const unlimited = await post(baseUrl, '/api/sections', { action: 'expire', s: tok, id: sid, days: 0 });
    assert.equal(unlimited.body.expires_at, null);
    const alive = await fetch(baseUrl + '/s/emi-vip', { headers: { Accept: 'text/plain' } });
    assert.equal(Buffer.from(await alive.text(), 'base64').toString('utf8'), 'line one\nline two');

    // Reset link: new random address, old address and custom name both stop working
    const reset = await post(baseUrl, '/api/sections', { action: 'key', s: tok, id: sid, reset: true });
    assert.notEqual(reset.body.key, key.body.key);
    assert.equal((await fetch(baseUrl + '/s/emi-vip')).status, 404);
    assert.equal((await fetch(baseUrl + '/s/' + key.body.key)).status, 404);
    assert.equal((await fetch(baseUrl + '/s/' + reset.body.key)).status, 200);

    // Short-link action needs a real domain; local host is refused, forwarded domain is accepted
    const noHost = await post(baseUrl, '/api/sections', { action: 'short', s: tok, id: sid });
    assert.equal(noHost.body.e, 'host');

    const adminUsers = await post(baseUrl, '/api/admin', {
      action: 'users', s: login.body.s,
    });
    assert.equal(adminUsers.status, 200);
    assert.equal(adminUsers.body.list.length, 1);

    const backup = await post(baseUrl, '/api/sections', {
      action: 'backup', s: login.body.s,
    });
    assert.equal(backup.status, 200);
    assert.equal(backup.body.data.sections.length, 1);

    const listed = await post(baseUrl, '/api/sections', {
      action: 'list', s: login.body.s,
    });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.list.length, 1);
    assert.equal(listed.body.list[0].title, 'Saved smoke section');

    const deleted = await post(baseUrl, '/api/sections', {
      action: 'del', s: login.body.s, id: created.body.sec.id,
    });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.ok, true);

    const loggedOut = await post(baseUrl, '/api/auth', {
      action: 'logout', s: login.body.s,
    });
    assert.equal(loggedOut.status, 200);
    assert.equal(loggedOut.body.ok, true);

    console.log('PASS: rules, env aliases, health, auth + password upgrade, section CRUD, custom link names, expiry, reset, subscription, admin, backup, and logout');
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      pause(1500),
    ]);
  }
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
