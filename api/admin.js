// ─────────────────────────────────────────────
//  POST /api/admin  —  مدیریت کاربران (فقط ادمین)
//
//  · users  : لیست همه‌ی کاربران (بدون رمز)
//  · role   : تغییر نقش کاربر (user ↔ admin)
//  · del    : حذف کاربر و همه‌ی بخش‌هایش
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
  const tok    = String(b.s || '');
  if (!/^[a-f0-9]{48}$/.test(tok)) return done(res, 400, { ok: false, e: 'sess' });

  try {
    const me = await meOf(tok);
    if (!me) return done(res, 401, { ok: false, e: 'sess' });
    if (me.role !== 'admin') return done(res, 403, { ok: false, e: 'forb' });

    if (action === 'users') return await users(res);
    if (action === 'role')  return await role(res, me, b);
    if (action === 'del')   return await del(res, me, b);
    return done(res, 400, { ok: false, e: 'action' });
  } catch (err) {
    return done(res, 500, { ok: false, e: 'db' });
  }
};

/* ---------- لیست کاربران ---------- */
async function users(res) {
  const rows = await sb('/rest/v1/users?order=created_at.asc&select=id,username,role,created_at');
  done(res, 200, { ok: true, list: rows || [] });
}

/* ---------- تغییر نقش ---------- */
async function role(res, me, b) {
  const id   = String(b.id || '');
  const role_ = String(b.r || '');
  if (!/^[0-9a-f-]{36}$/.test(id))              return done(res, 400, { ok: false, e: 'id' });
  if (role_ !== 'admin' && role_ !== 'user')    return done(res, 400, { ok: false, e: 'role' });
  if (id === me.id)                             return done(res, 400, { ok: false, e: 'self' });

  const ex = await sb(`/rest/v1/users?id=eq.${id}&select=id`);
  if (!ex || !ex.length) return done(res, 404, { ok: false, e: 'no' });

  await sbPatch(`/rest/v1/users?id=eq.${id}`, { role: role_ });
  done(res, 200, { ok: true });
}

/* ---------- حذف کاربر ---------- */
async function del(res, me, b) {
  const id = String(b.id || '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return done(res, 400, { ok: false, e: 'id' });
  if (id === me.id)                return done(res, 400, { ok: false, e: 'self' });

  const ex = await sb(`/rest/v1/users?id=eq.${id}&select=id`);
  if (!ex || !ex.length) return done(res, 404, { ok: false, e: 'no' });

  await sbDel(`/rest/v1/users?id=eq.${id}`);   // بخش‌ها و نشست‌ها با cascade حذف می‌شوند
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

const enc = s => encodeURIComponent(s);

/* ---- گفتگو با Supabase ---- */
async function sb(path) {
  const r = await fetch(URL_ + path, { headers: auth() });
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

function body(req) {
  return new Promise((ok, no) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 200000) no(new Error('big')); });
    req.on('end', () => ok(d));
    req.on('error', no);
  });
}

function done(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
