const URL_ = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY  = process.env.SUPABASE_SERVICE_KEY || '';
const MAXLEN = 262144;
const MAXSECS = 200;
const BODY_LIMIT = 4200000;

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
    if (action === 'get')     return await get(res, me, b);
    if (action === 'create')  return await create(res, me, b);
    if (action === 'save')    return await save(res, me, b);
    if (action === 'del')     return await del(res, me, b);
    if (action === 'key')     return await key(res, me, b);
    if (action === 'short')   return await short(res, me, b, req.headers.host);
    if (action === 'backup')  return await backup(res, me);
    if (action === 'restore') return await restore(res, me, b);
    return done(res, 400, { ok: false, e: 'action' });
  } catch (err) {
    return done(res, 500, { ok: false, e: 'db' });
  }
};

async function list(res, me) {
  const rows = await sb(`/rest/v1/sections?user_id=eq.${me.id}&order=sort_no.asc,created_at.asc&select=id,title,sub_key,sort_no,created_at&limit=${MAXSECS}`);
  const safe = (rows || []).map(r => ({ id: r.id, title: r.title, sub_key: r.sub_key, sort_no: r.sort_no, created_at: r.created_at }));
  done(res, 200, { ok: true, list: safe });
}

async function get(res, me, b) {
  const id = String(b.id || '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return done(res, 400, { ok: false, e: 'id' });
  const rows = await sb(`/rest/v1/sections?id=eq.${id}&user_id=eq.${me.id}&select=id,title,content,sub_key,sort_no&limit=1`);
  if (!rows || !rows.length) return done(res, 403, { ok: false, e: 'owner' });
  done(res, 200, { ok: true, sec: rows[0] });
}

async function create(res, me, b) {
  const title = String(b.title || '').slice(0, 60);
  const cnt = await sb(`/rest/v1/sections?user_id=eq.${me.id}&select=id&limit=${MAXSECS + 1}`);
  if (cnt && cnt.length >= MAXSECS) return done(res, 400, { ok: false, e: 'limit' });

  let nextSort = (cnt ? cnt.length : 0);
  try {
    const mx = await sb(`/rest/v1/sections?user_id=eq.${me.id}&order=sort_no.desc&select=sort_no&limit=1`);
    if (mx && mx.length && Number.isFinite(mx[0].sort_no)) nextSort = mx[0].sort_no + 1;
  } catch (e) {}

  const ins = await sbPost('/rest/v1/sections', { user_id: me.id, title, content: '', sort_no: nextSort }, true);
  done(res, 200, { ok: true, sec: ins && ins[0] });
}

async function save(res, me, b) {
  const id = String(b.id || '');
  const title = String(b.title || '').slice(0, 60);
  const content = String(b.content || '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return done(res, 400, { ok: false, e: 'id' });
  if (content.length > MAXLEN)     return done(res, 400, { ok: false, e: 'size' });

  const own = await sb(`/rest/v1/sections?id=eq.${id}&user_id=eq.${me.id}&select=id`);
  if (!own || !own.length) return done(res, 403, { ok: false, e: 'owner' });

  const patched = await sbPatchRet(`/rest/v1/sections?id=eq.${id}&user_id=eq.${me.id}`, { title, content });
  if (!patched) return done(res, 403, { ok: false, e: 'owner' });
  done(res, 200, { ok: true });
}

async function del(res, me, b) {
  const id = String(b.id || '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return done(res, 400, { ok: false, e: 'id' });

  const own = await sb(`/rest/v1/sections?id=eq.${id}&user_id=eq.${me.id}&select=id`);
  if (!own || !own.length) return done(res, 403, { ok: false, e: 'owner' });

  await sbDel(`/rest/v1/sections?id=eq.${id}&user_id=eq.${me.id}`);
  done(res, 200, { ok: true });
}

async function key(res, me, b) {
  const id = String(b.id || '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return done(res, 400, { ok: false, e: 'id' });

  const own = await sb(`/rest/v1/sections?id=eq.${id}&user_id=eq.${me.id}&select=id`);
  if (!own || !own.length) return done(res, 403, { ok: false, e: 'owner' });

  let nk = null;
  for (let i = 0; i < 20; i++) {
    const cand = rand(8);
    const ex = await sb(`/rest/v1/sections?sub_key=eq.${cand}&select=id&limit=1`);
    if (!ex || !ex.length) { nk = cand; break; }
  }
  if (!nk) return done(res, 500, { ok: false, e: 'db' });

  try {
    await sbPatch(`/rest/v1/sections?id=eq.${id}&user_id=eq.${me.id}`, { sub_key: nk });
  } catch (e) {
    return done(res, 500, { ok: false, e: 'db' });
  }
  done(res, 200, { ok: true, key: nk });
}

async function short(res, me, b, host) {
  const key = String(b.key || '');
  if (!/^[a-f0-9]{16}$/.test(key)) return done(res, 400, { ok: false, e: 'key' });
  const own = await sb(`/rest/v1/sections?sub_key=eq.${key}&user_id=eq.${me.id}&select=id&limit=1`);
  if (!own || !own.length) return done(res, 403, { ok: false, e: 'owner' });
  const h = String(host || '').split(':')[0].toLowerCase();
  if (!h.includes('.') || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(h)) return done(res, 400, { ok: false, e: 'host' });
  const direct = 'https://' + h + '/s/' + key;
  const sh = await shorten(direct);
  done(res, 200, { ok: true, key, direct, short: sh });
}

async function shorten(u) {
  const q = encodeURIComponent(u);
  const jsonShort = t => {
    try {
      const j = JSON.parse(t);
      return (j && typeof j.shorturl === 'string' && /^https:\/\//i.test(j.shorturl)) ? j.shorturl : '';
    } catch (e) { return ''; }
  };
  const tasks = [
    grab('https://is.gd/create.php?format=json&url=' + q, 6500).then(jsonShort),
    grab('https://v.gd/create.php?format=json&url=' + q, 6500).then(jsonShort),
    grab('https://spoo.me/', 6500, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'url=' + q
    }).then(t => {
      try {
        const j = JSON.parse(t);
        return (j && typeof j.short_url === 'string') ? j.short_url.replace(/^http:/i, 'https:') : '';
      } catch (e) { return ''; }
    }),
    grab('https://tinyurl.com/api-create.php?url=' + q, 6500).then(t => {
      t = t.trim();
      return /^https:\/\/tinyurl\.com\/[a-z0-9]+$/i.test(t) ? t : '';
    })
  ];
  const r = await Promise.all(tasks.map(p => p.catch(() => '')));
  return r.find(x => /^https:\/\//i.test(x)) || '';
}

async function grab(u, ms, opt) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(u, Object.assign({ signal: c.signal }, opt || {}));
    if (!r.ok) throw new Error('http');
    return await r.text();
  } finally { clearTimeout(t); }
}

async function backup(res, me) {
  if (me.role !== 'admin') return done(res, 403, { ok: false, e: 'forb' });

  const users = await sb('/rest/v1/users?select=id,username,role,created_at&limit=1000');
  const secs  = await sb('/rest/v1/sections?select=id,user_id,title,content,sub_key,sort_no,created_at&limit=2000');
  const byId = {};
  (users || []).forEach(u => { byId[u.id] = u.username; });

  const payload = {
    app: 'panel-vercel-sub',
    version: 1,
    at: new Date().toISOString(),
    users: (users || []).map(u => ({ username: u.username, role: u.role })),
    sections: (secs || []).map(s => ({ user: byId[s.user_id] || '', title: s.title, content: s.content, sub_key: s.sub_key, sort: s.sort_no }))
  };

  done(res, 200, { ok: true, data: payload });
}

async function restore(res, me, b) {
  if (me.role !== 'admin') return done(res, 403, { ok: false, e: 'forb' });
  if (!b || typeof b.data !== 'object' || !b.data || !Array.isArray(b.data.sections))
    return done(res, 400, { ok: false, e: 'bad' });

  const d = b.data;
  const mine = await sb(`/rest/v1/sections?user_id=eq.${me.id}&select=id&limit=${MAXSECS + 1}`);
  const have = (mine && mine.length) || 0;
  if (have >= MAXSECS) return done(res, 400, { ok: false, e: 'limit' });
  const room = MAXSECS - have;

  const used = new Set();
  try {
    const all = await sb('/rest/v1/sections?select=sub_key&limit=2000');
    (all || []).forEach(r => { if (r && r.sub_key) used.add(r.sub_key); });
  } catch (e) {}

  const clean = [];
  for (const s of d.sections) {
    if (clean.length >= room) break;
    if (!s || typeof s.content !== 'string' || s.content.length > MAXLEN) continue;
    const title = String(s.title || '').slice(0, 60);
    let subKey = (typeof s.sub_key === 'string' && /^[a-f0-9]{16}$/.test(s.sub_key) && !used.has(s.sub_key)) ? s.sub_key : null;
    if (!subKey) {
      for (let i = 0; i < 10; i++) {
        const cand = rand(8);
        if (!used.has(cand)) { subKey = cand; break; }
      }
      if (!subKey) continue;
    }
    used.add(subKey);
    clean.push({ title, content: s.content, sub_key: subKey });
  }

  let base = have;
  try {
    const mx = await sb(`/rest/v1/sections?user_id=eq.${me.id}&order=sort_no.desc&select=sort_no&limit=1`);
    if (mx && mx.length && Number.isFinite(mx[0].sort_no)) base = mx[0].sort_no + 1;
  } catch (e) {}

  let added = 0;
  for (let i = 0; i < clean.length; i++) {
    try {
      await sbPost('/rest/v1/sections', { user_id: me.id, title: clean[i].title, content: clean[i].content, sub_key: clean[i].sub_key, sort_no: base + i });
      added++;
    } catch (e) {}
  }

  done(res, 200, { ok: true, added });
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

function rand(n) {
  try {
    return require('crypto').randomBytes(n).toString('hex');
  } catch (e) {
    return [...crypto.getRandomValues(new Uint8Array(n))].map(x => x.toString(16).padStart(2, '0')).join('');
  }
}
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
  return r.json().catch(() => []);
}
async function sbPatchRet(path, obj) {
  const r = await fetch(URL_ + path, {
    method: 'PATCH',
    headers: { ...auth(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(obj)
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j || !j.length) return null;
  return j;
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
    req.on('data', c => { d += c; if (d.length > BODY_LIMIT) no(new Error('big')); });
    req.on('end', () => ok(d));
    req.on('error', no);
  });
}

function done(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
