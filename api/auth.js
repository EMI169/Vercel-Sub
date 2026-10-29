const URL_ = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY  = process.env.SUPABASE_SERVICE_KEY || '';
const ALLOW_REGISTER = String(process.env.ALLOW_REGISTER || '0') === '1';

const USER_RE = /^[a-z0-9_.-]+$/;
const USER_MIN = 3, USER_MAX = 32;
const PASS_MIN = 5, PASS_MAX = 128;

const _hits = new Map();
function rateOk(ip) {
  const now = Date.now();
  const h = _hits.get(ip) || { n: 0, t: now };
  if (now - h.t > 60000) { h.n = 0; h.t = now; }
  h.n++;
  _hits.set(ip, h);
  if (_hits.size > 2000) { const k = _hits.keys().next().value; _hits.delete(k); }
  return h.n <= 20;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return done(res, 405, { ok: false, e: 'method' });
  if (!URL_ || !KEY) return done(res, 500, { ok: false, e: 'env' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  if (!rateOk(ip)) {
    res.setHeader('Retry-After', '60');
    return done(res, 429, { ok: false, e: 'rate' });
  }

  let b = null;
  try { b = JSON.parse(await body(req)); } catch (err) { b = null; }
  if (!b || typeof b !== 'object') return done(res, 400, { ok: false, e: 'body' });

  const action = String(b.action || '');
  const user   = String(b.u || '').trim().toLowerCase();
  const pass   = String(b.p || '');

  try {
    if (action === 'login')     return await login(res, user, pass);
    if (action === 'setup')     return await setup(res, b);
    if (action === 'register')  return await register(res, user, pass);
    if (action === 'logout')    return await logout(res, b);
    if (action === 'pass')      return await changePass(res, b);
    return done(res, 400, { ok: false, e: 'action' });
  } catch (err) {
    return done(res, 500, { ok: false, e: 'db' });
  }
};

function badUser(u) {
  if (!u || u.length < USER_MIN) return true;
  if (u.length > USER_MAX) return true;
  if (!USER_RE.test(u)) return true;
  return false;
}
function badPass(p) {
  if (!p || p.length < PASS_MIN) return 'short';
  if (p.length > PASS_MAX) return 'long';
  return null;
}

async function login(res, user, pass) {
  if (badUser(user) || !pass) return done(res, 400, { ok: false, e: 'input' });
  if (pass.length > PASS_MAX) return done(res, 400, { ok: false, e: 'input' });

  const r = await sb(`/rest/v1/users?username=eq.${enc(user)}&select=id,username,pass_hash,salt,role`);
  const rows = (r && Array.isArray(r)) ? r : [];
  if (!rows.length) return done(res, 401, { ok: false, e: 'no' });

  const u = rows[0];
  const h = sha256(u.salt + '\u0000' + pass);

  if (u.username === 'admin' && u.pass_hash === 'DEFAULT') {
    if (pass !== 'admin') return done(res, 401, { ok: false, e: 'no' });
    const tok = rand(24);
    await sbPost('/rest/v1/sessions', { token: tok, user_id: u.id, expires_at: futureMinutes(15) }, true);
    return done(res, 200, { ok: true, mustSetup: true, s: tok, role: 'admin', u: 'admin' });
  }

  if (h !== u.pass_hash) return done(res, 401, { ok: false, e: 'no' });

  const tok = rand(24);
  await sbPost('/rest/v1/sessions', { token: tok, user_id: u.id, expires_at: futureDays(30) }, true);
  done(res, 200, { ok: true, s: tok, role: u.role, u: u.username });
}

async function setup(res, b) {
  const tok = String(b.s || '');
  const p1  = String(b.p1 || '');
  const p2  = String(b.p2 || '');
  if (!/^[a-f0-9]{48}$/.test(tok)) return done(res, 400, { ok: false, e: 'input' });
  const bp = badPass(p1);
  if (bp) return done(res, 400, { ok: false, e: bp === 'long' ? 'long' : 'short' });
  if (p1 !== p2)      return done(res, 400, { ok: false, e: 'match' });

  const me = await meOf(tok);
  if (!me) return done(res, 401, { ok: false, e: 'sess' });
  if (me.username !== 'admin') return done(res, 403, { ok: false, e: 'forb' });

  const r = await sb(`/rest/v1/users?username=eq.admin&select=id,pass_hash`);
  if (!r || !r.length || r[0].pass_hash !== 'DEFAULT') return done(res, 400, { ok: false, e: 'done' });

  const salt = rand(16);
  const h = sha256(salt + '\u0000' + p1);
  await sbPatch('/rest/v1/users?id=eq.' + me.id, { pass_hash: h, salt });
  try { await sbDel('/rest/v1/sessions?token=eq.' + tok); } catch (e) {}
  done(res, 200, { ok: true });
}

async function register(res, user, pass) {
  if (!ALLOW_REGISTER) return done(res, 403, { ok: false, e: 'closed' });
  if (badUser(user))  return done(res, 400, { ok: false, e: 'user' });
  const bp = badPass(pass);
  if (bp) return done(res, 400, { ok: false, e: bp === 'long' ? 'long' : 'short' });

  let isFirst = false;
  try {
    const one = await sb('/rest/v1/users?select=id&order=created_at.asc&limit=1');
    isFirst = !(one && one.length);
  } catch (e) { isFirst = false; }
  const role = isFirst ? 'admin' : 'user';

  const ex = await sb(`/rest/v1/users?username=eq.${enc(user)}&select=id`);
  if (ex && ex.length) return done(res, 409, { ok: false, e: 'exists' });

  const salt = rand(16);
  const h = sha256(salt + '\u0000' + pass);
  const ins = await sbPost('/rest/v1/users', { username: user, pass_hash: h, salt, role }, true);
  const id = ins && ins[0] && ins[0].id;
  if (!id) return done(res, 500, { ok: false, e: 'db' });

  let finalRole = role;
  if (role === 'admin') {
    try {
      const oldest = await sb('/rest/v1/users?select=id&order=created_at.asc&limit=1');
      if (oldest && oldest.length && oldest[0].id !== id) {
        await sbPatch('/rest/v1/users?id=eq.' + id, { role: 'user' });
        finalRole = 'user';
      }
    } catch (e) {}
  }

  const tok = rand(24);
  await sbPost('/rest/v1/sessions', { token: tok, user_id: id, expires_at: futureDays(30) }, true);
  return done(res, 200, { ok: true, s: tok, role: finalRole, u: user });
}

async function logout(res, b) {
  const tok = String(b.s || '');
  if (!/^[a-f0-9]{48}$/.test(tok)) return done(res, 400, { ok: false, e: 'input' });
  try { await sbDel('/rest/v1/sessions?token=eq.' + tok); } catch (e) {}
  done(res, 200, { ok: true });
}

async function changePass(res, b) {
  const tok  = String(b.s || '');
  const old  = String(b.old || '');
  const p1   = String(b.p1 || '');
  const p2   = String(b.p2 || '');
  if (!/^[a-f0-9]{48}$/.test(tok)) return done(res, 400, { ok: false, e: 'input' });
  const bp = badPass(p1);
  if (bp) return done(res, 400, { ok: false, e: bp === 'long' ? 'long' : 'short' });
  if (p1 !== p2)      return done(res, 400, { ok: false, e: 'match' });
  if (String(old).length > PASS_MAX) return done(res, 400, { ok: false, e: 'input' });

  const me = await meOf(tok);
  if (!me) return done(res, 401, { ok: false, e: 'sess' });

  const r = await sb(`/rest/v1/users?id=eq.${enc(me.id)}&select=pass_hash,salt`);
  if (!r || !r.length) return done(res, 404, { ok: false, e: 'no' });
  if (r[0].pass_hash !== 'DEFAULT') {
    const hOld = sha256(r[0].salt + '\u0000' + old);
    if (hOld !== r[0].pass_hash) return done(res, 401, { ok: false, e: 'old' });
  } else if (old !== 'admin') {
    return done(res, 401, { ok: false, e: 'old' });
  }

  const salt = rand(16);
  const h = sha256(salt + '\u0000' + p1);
  await sbPatch('/rest/v1/users?id=eq.' + me.id, { pass_hash: h, salt });
  try { await sbDel(`/rest/v1/sessions?user_id=eq.${enc(me.id)}&token=neq.${tok}`); } catch (e) {}
  done(res, 200, { ok: true });
}

function meOf(tok) {
  return sb(`/rest/v1/sessions?token=eq.${tok}&select=user_id,expires_at`)
    .then(async rows => {
      if (!rows || !rows.length) return null;
      if (new Date(rows[0].expires_at) < new Date()) { try { await sbDel('/rest/v1/sessions?token=eq.' + tok); } catch (e) {} return null; }
      const u = await sb(`/rest/v1/users?id=eq.${rows[0].user_id}&select=id,username,role`);
      return (u && u.length) ? u[0] : null;
    });
}

function futureDays(days) {
  return new Date(Date.now() + days * 86400000).toISOString();
}
function futureMinutes(min) {
  return new Date(Date.now() + min * 60000).toISOString();
}
const enc = s => encodeURIComponent(s);

function sha256(str) {
  try {
    return require('crypto').createHash('sha256').update(String(str), 'utf8').digest('hex');
  } catch (e) {
    let h1 = 0x6a09e667, h2 = 0xbb67ae85;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h1 = (h1 * 31 + s.charCodeAt(i)) | 0; h2 = (h2 * 37 + s.charCodeAt(i)) | 0; }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }
}
function rand(n) {
  try {
    return require('crypto').randomBytes(n).toString('hex');
  } catch (e) {
    return [...crypto.getRandomValues(new Uint8Array(n))].map(x => x.toString(16).padStart(2, '0')).join('');
  }
}

async function sb(path) {
  const r = await fetch(URL_ + path, { headers: auth() });
  if (!r.ok) throw new Error('sb');
  return r.json();
}
async function sbPost(path, obj, ret) {
  const r = await fetch(URL_ + path, {
    method: 'POST',
    headers: { ...auth(), 'Content-Type': 'application/json', ...(ret ? { Prefer: 'return=representation' } : {}) },
    body: JSON.stringify(obj)
  });
  if (!r.ok) throw new Error('sb');
  return r.json();
}
async function sbPatch(path, obj) {
  const r = await fetch(URL_ + path, {
    method: 'PATCH',
    headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  });
  if (!r.ok) throw new Error('sb');
  return r.json();
}
async function sbDel(path) {
  const r = await fetch(URL_ + path, { method: 'DELETE', headers: auth() });
  if (!r.ok) throw new Error('sb');
  return r.json().catch(() => []);
}
function auth() { return { apikey: KEY, Authorization: 'Bearer ' + KEY }; }

function body(req) {
  return new Promise((ok, no) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 500000) no(new Error('big')); });
    req.on('end', () => ok(d));
    req.on('error', no);
  });
}

function done(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
