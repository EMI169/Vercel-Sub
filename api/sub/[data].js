const { getSupabaseConfig, supabaseRequest } = require('../../lib/supabase');
const { isKey, isSlug, isExpired } = require('../../lib/sub-rules');
const CONFIG = getSupabaseConfig();

// Shown inside v2rayNG / similar apps after a link expires, so the old configs get replaced.
const EXPIRED_LINE = 'vless://00000000-0000-0000-0000-000000000000@127.0.0.1:1?encryption=none&type=tcp#'
  + encodeURIComponent('⛔ اشتراک منقضی شد | Subscription expired');

module.exports = async (req, res) => {
  try {
    let seg = '';
    try {
      seg = decodeURIComponent((req.url || '').split('?')[0].split('/').filter(Boolean).pop() || '');
    } catch (e) {
      return notFound(res, false);
    }
    seg = String(seg).trim().toLowerCase();
    const wantsHTML = (req.headers['accept'] || '').includes('text/html');

    let field = '';
    if (isKey(seg)) field = 'sub_key';
    else if (isSlug(seg)) field = 'slug';
    else return notFound(res, wantsHTML);
    if (!CONFIG.ok) return dbErr(res, wantsHTML);

    let row = null;
    try {
      const rows = await supabaseRequest(`/rest/v1/sections?${field}=eq.${encodeURIComponent(seg)}&select=content,title,expires_at&limit=1`);
      if (rows && rows.length) row = rows[0];
    } catch (err) { return dbErr(res, wantsHTML); }

    if (!row) return notFound(res, wantsHTML);
    const title = String(row.title || '').trim() || 'Sub Panel';
    const expired = isExpired(row.expires_at);
    const headers = {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Profile-Title': 'base64:' + Buffer.from(title, 'utf8').toString('base64'),
      'Profile-Update-Interval': '12',
    };
    if (row.expires_at) {
      const exp = Math.floor(Date.parse(row.expires_at) / 1000);
      if (Number.isFinite(exp)) headers['Subscription-Userinfo'] = `upload=0; download=0; total=0; expire=${exp}`;
    }

    if (expired) {
      if (wantsHTML) return expiredPage(res, title, row.expires_at);
      res.writeHead(200, headers);
      return res.end(Buffer.from(EXPIRED_LINE, 'utf8').toString('base64'));
    }

    const text = String(row.content || '');
    if (wantsHTML) return htmlPage(res, text, title, row.expires_at);

    res.writeHead(200, headers);
    res.end(Buffer.from(text, 'utf8').toString('base64'));
  } catch (e) {
    try { return notFound(res, false); } catch (_) {}
  }
};

const BASE_CSS = 'font-family:Vazirmatn,Tahoma,sans-serif;background:#0f1216;color:#e8e6e3;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:16px';

function notFound(res, html) {
  if (html) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<meta name="viewport" content="width=device-width,initial-scale=1"><body dir="rtl" style="${BASE_CSS}"><div>این لینک معتبر نیست یا حذف شده است.</div></body>`);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('not found');
  }
}

function dbErr(res, html) {
  if (html) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<meta name="viewport" content="width=device-width,initial-scale=1"><body dir="rtl" style="${BASE_CSS}"><div>خطای سرور — تنظیمات Supabase را بررسی کن.</div></body>`);
  } else {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('error');
  }
}

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function faDate(iso) {
  try { return new Date(iso).toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch (e) { return String(iso || ''); }
}

function expiredPage(res, title, exp) {
  res.writeHead(410, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="${BASE_CSS}"><div><div style="font-size:42px">⛔</div><h1 style="font-size:18px;margin:8px 0">${esc(title)}</h1>
<p style="color:#f87171;margin:0">مدت اعتبار این اشتراک تمام شده است.</p>
<p style="color:#9aa4af;font-size:13px">تاریخ پایان: ${esc(faDate(exp))}</p></div></body></html>`);
}

function htmlPage(res, text, title, exp) {
  const lines = (text || '').split('\n').filter(l => l.trim());
  const list = lines.length
    ? lines.map(l => `<li><code>${esc(l)}</code></li>`).join('')
    : '<li><code style="color:#9aa4af">— این بخش خالی است —</code></li>';
  const expLine = exp ? `<p>فعال تا: <b style="color:#fbbf24">${esc(faDate(exp))}</b></p>` : '';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:Vazirmatn,Tahoma,sans-serif;background:#0f1216;color:#e8e6e3;margin:0;padding:24px}
.wrap{max-width:720px;margin:0 auto}h1{font-size:18px}p{color:#9aa4af;font-size:13px}
ul{list-style:none;padding:0}li{background:#161b22;border:1px solid #262d37;border-radius:10px;padding:10px 14px;margin:8px 0}
code{font-family:ui-monospace,Consolas,monospace;font-size:12px;direction:ltr;display:block;text-align:left;word-break:break-all;color:#8fd3a0}</style></head>
<body><div class="wrap"><h1>${esc(title)}</h1>
<p>این صفحه فقط برای مشاهده در مرورگر است؛ اپ‌ها (v2rayNG / PattNG) همین آدرس را به‌صورت خودکار دریافت می‌کنند.</p>
${expLine}<ul>${list}</ul></div></body></html>`);
}
