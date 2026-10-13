// ─────────────────────────────────────────────
//  POST /api/sections  —  مدیریت ساب‌ها + بکاپ
//  اکشن‌ها: list / create / save / del / key /
//           backup (ادمین) / restore (ادمین)
// ─────────────────────────────────────────────

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY  = process.env.SUPABASE_SERVICE_KEY || '';
const MAXLEN = 262144;

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

    if (action === 'list')    return await list(res, me);
    if (action === 'create')  return await create(res, me, b);
    if (action === 'save')    return await save(res, me, b);
    if (action === 'del')     return await del(res, me, b);
    if (action === 'key')     return await key(res, me, b);
    if (action === 'backup')  return await backup(res, me);
    if (action === 'restore') return await restore(res, me, b);
    return done(res, 400, { ok: false, e: 'action' });
  } catch (err) {
    return done(res, 500, { ok: false, e: 'db' });
  }
};

/* ---------- لیست ---------- */
async function list(res, me) {
  const rows = await sb(`/rest/v1/sections?user_id=eq.${me.id}&order=sort_no.asc,created_at.asc&select=id,title,content,sub_key,sort_no,created_at`);
  done(res, 200, { ok: true, list: rows || [] });
}

/* ---------- ساخت ---------- */
async function create(res, me, b) {
  const title = String(b.title || '').slice(0, 60);
  const cnt = await sb(`/rest/v1/sections?user_id=eq.${me.id}&select=id`);
  if (cnt && cnt.length >= 200) return done(res, 400, { ok: false, e: 'limit' });

  const ins = await sbPost('/rest/v1/sections', { user_id: me.id, title, content: '', sort_no: (cnt ? cnt.length : 0) }, true);
  done(res, 200, { ok: true, sec: ins && ins[0] });
}

/* ---------- ذخیره ---------- */
async function save(res, me, b) {
  const id = String(b.id || '');
  const title = String(b.title || '').slice(0, 60);
  const content = String(b.content || '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return done(res, 400, { ok: false, e: 'id' });
  if (content.length > MAXLEN)     return done(res, 400, { ok: false, e: 'size' });

  const own = await sb(`/rest/v1/sections?id=eq.${id}&user_id=eq.${me.id}&select=id`);
  if (!own || !own.length) return done(res, 403, { ok: false, e: 'owner' });

  await sbPatch(`/rest/v1/sections?id=eq.${id}`, { title, content });
  done(res, 200, { ok: true });
}

/* ---------- حذف ---------- */
async function del(res, me, b) {
  const id = String(b.id || '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return done(res, 400, { ok: false, e: 'id' });

  const own = await sb(`/rest/v1/sections?id=eq.${id}&user_id=eq.${me.id}&select=id`);
  if (!own || !own.length) return done(res, 403, { ok: false, e: 'owner' });

  await sbDel(`/rest/v1/sections?id=eq.${id}`);
  done(res, 200, { ok: true });
}

/* ---------- ساخت/تعویض شناسه‌ی ساب ---------- */
async function key(res, me, b) {
  const id = String(b.id || '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return done(res, 400, { ok: false, e: 'id' });

  const own = await sb(`/rest/v1/sections?id=eq.${id}&user_id=eq.${me.id}&select=id`);
  if (!own || !own.length) return done(res, 403, { ok: false, e: 'owner' });

  let nk = rand(8);
  for (let i = 0; i < 5; i++) {
    const ex = await sb(`/rest/v1/sections?sub_key=eq.${nk}&select=id`);
    if (!ex || !ex.length) break;
    nk = rand(8);
  }

  await sbPatch(`/rest/v1/sections?id=eq.${id}`, { sub_key: nk });
  done(res, 200, { ok: true, key: nk });
}

/* ---------- بکاپ (ادمین) ---------- */
async function backup(res, me) {
  if (me.role !== 'admin') return done(res, 403, { ok: false, e: 'forb' });

  const users = await sb('/rest/v1/users?select=id,username,role,created_at');
  const secs  = await sb('/rest/v1/sections?select=id,user_id,title,content,sub_key,sort_no,created_at');

  const payload = {
    app: 'panel-vercel-sub',
    version: 1,
    at: new Date().toISOString(),
    users: (users || []).map(u => ({ username: u.username, role: u.role })),
    sections: (secs || []).map(s => ({ user: (users || []).find(u => u.id === s.user_id) ? (users || []).find(u => u.id === s.user_id).username : '', title: s.title, content: s.content, sub_key: s.sub_key, sort: s.sort_no }))
  };

  done(res, 200, { ok: true, data: payload });
}

/* ---------- بازیابی (ادمین) ---------- */
async function restore(res, me, b) {
  if (me.role !== 'admin') return done(res, 403, { ok: false, e: 'forb' });
  if (!b || typeof b.data !== 'object' || !b.data || !Array.isArray(b.data.sections))
    return done(res, 400, { ok: false, e: 'bad' });

  const d = b.data;
  let added = 0;

  for (const s of d.sections) {
    if (typeof s.content !== 'string' || s.content.length > MAXLEN) continue;
    const title = String(s.title || '').slice(0, 60);
    const subKey = (typeof s.sub_key === 'string' && /^[a-f0-9]{16}$/.test(s.sub_key)) ? s.sub_key : null;
    await sbPost('/rest/v1/sections', { user_id: me.id, title, content: s.content, sub_key: subKey, sort_no: added });
    added++;
    if (added >= 200) break;
  }

  done(res, 200, { ok: true, added });
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

const rand = n => [...crypto.getRandomValues(new Uint8Array(n))].map(x => x.toString(16).padStart(2, '0')).join('');
const enc = s => encodeURIComponent(s);

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
