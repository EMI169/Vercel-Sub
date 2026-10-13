// ─────────────────────────────────────────────
//  POST /api/auth  —  ورود / ثبت‌نام / خروج / تغییر رمز
//
//  · اکشن login   : ورود؛ اگر admin و رمزِ پیش‌فرض، ورودِ موقت می‌گیرد
//                    و باید با 'setup' رمز جدید ست شود
//  · اکشن setup   : ست کردن رمز واقعی برای اولین admin
//  · اکشن register: ثبت‌نام کاربر جدید (فقط وقتی هیچ کاربری نیست،
//                    اولین نفر admin می‌شود؛ وگرنه نقش user)
//  · اکشن logout  : حذف نشست
//  · اکشن pass    : تغییر رمز خود کاربر
// ─────────────────────────────────────────────

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY  = process.env.SUPABASE_SERVICE_KEY || '';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return done(res, 405, { ok: false, e: 'method' });
  if (!URL_ || !KEY) return done(res, 500, { ok: false, e: 'env' });

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

/* ---------- ورود ---------- */
async function login(res, user, pass) {
  if (!user || !pass) return done(res, 400, { ok: false, e: 'input' });

  const r = await sb(`/rest/v1/users?username=eq.${enc(user)}&select=id,username,pass_hash,salt,role`);
  const rows = (r && Array.isArray(r)) ? r : [];
  if (!rows.length) return done(res, 401, { ok: false, e: 'no' });

  const u = rows[0];
  const h = await sha256(u.salt + '\u0000' + pass);

  // admin با رمز پیش‌فرض → نشست موقت، باید setup شود
  if (u.username === 'admin' && u.pass_hash === 'DEFAULT') {
    if (pass !== 'admin') return done(res, 401, { ok: false, e: 'no' });
    const tok = rand(24);
    await sbPost('/rest/v1/sessions', { token: tok, user_id: u.id, expires_at: future(15) }, true);
    return done(res, 200, { ok: true, mustSetup: true, s: tok, role: 'admin', u: 'admin' });
  }

  if (h !== u.pass_hash) return done(res, 401, { ok: false, e: 'no' });

  const tok = rand(24);
  await sbPost('/rest/v1/sessions', { token: tok, user_id: u.id, expires_at: future(30) }, true);
  done(res, 200, { ok: true, s: tok, role: u.role, u: u.username });
}

/* ---------- ست کردن رمز واقعی اولین admin ---------- */
async function setup(res, b) {
  const tok = String(b.s || '');
  const p1  = String(b.p1 || '');
  const p2  = String(b.p2 || '');
  if (!/^[a-f0-9]{48}$/.test(tok)) return done(res, 400, { ok: false, e: 'input' });
  if (p1.length < 5)  return done(res, 400, { ok: false, e: 'short' });
  if (p1 !== p2)      return done(res, 400, { ok: false, e: 'match' });

  const me = await meOf(tok);
  if (!me) return done(res, 401, { ok: false, e: 'sess' });
  if (me.username !== 'admin') return done(res, 403, { ok: false, e: 'forb' });

  const r = await sb(`/rest/v1/users?username=eq.admin&select=id,pass_hash`);
  if (!r || !r.length || r[0].pass_hash !== 'DEFAULT') return done(res, 400, { ok: false, e: 'done' });

  const salt = rand(16);
  const h = await sha256(salt + '\u0000' + p1);
  await sbPatch('/rest/v1/users?id=eq.' + me.id, { pass_hash: h, salt });
  done(res, 200, { ok: true });
}

/* ---------- ثبت‌نام ---------- */
async function register(res, user, pass) {
  if (!user || user.length < 3)  return done(res, 400, { ok: false, e: 'user' });
  if (!pass || pass.length < 5)  return done(res, 400, { ok: false, e: 'short' });

  const cnt = await sb('/rest/v1/users?select=id');
  const n = (cnt && Array.isArray(cnt)) ? cnt.length : 0;
  const role = n === 0 ? 'admin' : 'user';   // اولین نفر ادمین

  const ex = await sb(`/rest/v1/users?username=eq.${enc(user)}&select=id`);
  if (ex && ex.length) return done(res, 409, { ok: false, e: 'exists' });

  const salt = rand(16);
  const h = await sha256(salt + '\u0000' + pass);
  const ins = await sbPost('/rest/v1/users', { username: user, pass_hash: h, salt, role }, true);
  const id = ins && ins[0] && ins[0].id;

  if (role === 'admin' && id) {
    // اولین ادمین: بی‌درنگ با mustSetup=true وارد شود
    const tok = rand(24);
    await sbPost('/rest/v1/sessions', { token: tok, user_id: id, expires_at: future(15) }, true);
    return done(res, 200, { ok: true, mustSetup: true, s: tok, role: 'admin', u: user });
  }

  if (role === 'user' && id) {
    const tok = rand(24);
    await sbPost('/rest/v1/sessions', { token: tok, user_id: id, expires_at: future(30) }, true);
    return done(res, 200, { ok: true, s: tok, role: 'user', u: user });
  }
  done(res, 500, { ok: false, e: 'db' });
}

/* ---------- خروج ---------- */
async function logout(res, b) {
  const tok = String(b.s || '');
  if (!/^[a-f0-9]{48}$/.test(tok)) return done(res, 400, { ok: false, e: 'input' });
  await sbDel('/rest/v1/sessions?token=eq.' + tok);
  done(res, 200, { ok: true });
}

/* ---------- تغییر رمز ---------- */
async function changePass(res, b) {
  const tok  = String(b.s || '');
  const old  = String(b.old || '');
  const p1   = String(b.p1 || '');
  const p2   = String(b.p2 || '');
  if (!/^[a-f0-9]{48}$/.test(tok)) return done(res, 400, { ok: false, e: 'input' });
  if (p1.length < 5)  return done(res, 400, { ok: false, e: 'short' });
  if (p1 !== p2)      return done(res, 400, { ok: false, e: 'match' });

  const me = await meOf(tok);
  if (!me) return done(res, 401, { ok: false, e: 'sess' });

  // بررسی رمز قدیمی
  const r = await sb(`/rest/v1/users?id=eq.${enc(me.id)}&select=pass_hash,salt`);
  if (!r || !r.length) return done(res, 404, { ok: false, e: 'no' });
  if (r[0].pass_hash !== 'DEFAULT') {
    const hOld = await sha256(r[0].salt + '\u0000' + old);
    if (hOld !== r[0].pass_hash) return done(res, 401, { ok: false, e: 'old' });
  } else if (old !== 'admin') {
    return done(res, 401, { ok: false, e: 'old' });
  }

  const salt = rand(16);
  const h = await sha256(salt + '\u0000' + p1);
  await sbPatch('/rest/v1/users?id=eq.' + me.id, { pass_hash: h, salt });
  done(res, 200, { ok: true });
}

/* ---------- ابزار ---------- */
function meOf(tok) {
  return sb(`/rest/v1/sessions?token=eq.${tok}&select=user_id,expires_at`)
    .then(async rows => {
      if (!rows || !rows.length) return null;
      if (new Date(rows[0].expires_at) < new Date()) { await sbDel('/rest/v1/sessions?token=eq.' + tok); return null; }
      const u = await sb(`/rest/v1/users?id=eq.${rows[0].user_id}&select=id,username,role`);
      return (u && u.length) ? u[0] : null;
    });
}

function future(days) {
  return new Date(Date.now() + days * 86400000).toISOString();
}
const enc = s => encodeURIComponent(s);

async function sha256(str) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const rand = n => [...crypto.getRandomValues(new Uint8Array(n))].map(x => x.toString(16).padStart(2, '0')).join('');

/* ---- گفتگو با Supabase (service_role) ---- */
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
  return r.json();
}
function auth() { return { apikey: KEY, Authorization: 'Bearer ' + KEY }; }

/* ---- خواندن بدنه‌ی درخواست ---- */
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
