// ─────────────────────────────────────────────
//  GET /s/<شناسه‌ی ۱۶hex>  →  سابسکریپشن
//  محتوا هر بار از Supabase خوانده می‌شود؛ آدرس ثابت است.
//  مرورگر → صفحه‌ی خوانا   |   اپ → base64 استاندارد
//  بخش بدون sub_key = این بخش هنوز لینک ندارد
// ─────────────────────────────────────────────

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY  = process.env.SUPABASE_SERVICE_KEY || '';

module.exports = async (req, res) => {
  const seg = decodeURIComponent((req.url || '').split('?')[0].split('/').filter(Boolean).pop() || '');
  const wantsHTML = (req.headers['accept'] || '').includes('text/html');

  if (!/^[a-f0-9]{16}$/.test(seg)) return notFound(res, wantsHTML);
  if (!URL_ || !KEY) return dbErr(res, wantsHTML);

  let text = null;
  try {
    const rows = await sb(`/rest/v1/sections?sub_key=eq.${seg}&select=content,title`);
    if (rows && rows.length) text = String(rows[0].content || '');
  } catch (err) { return dbErr(res, wantsHTML); }

  if (text == null) return notFound(res, wantsHTML);
  text = String(text || '');

  if (wantsHTML) return htmlPage(res, text);

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Profile-Title': 'base64:' + Buffer.from('Sub Panel').toString('base64')
  });
  res.end(Buffer.from(text, 'utf8').toString('base64'));
};

/* ---- گفتگو با Supabase ---- */
async function sb(path) {
  const r = await fetch(URL_ + path, { headers: auth() });
  if (!r.ok) throw new Error('sb');
  return r.json();
}
function auth() { return { apikey: KEY, Authorization: 'Bearer ' + KEY }; }

/* ---- ۴۰۴ ---- */
function notFound(res, html) {
  if (html) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Tahoma;background:#0f1216;color:#e8e6e3;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div>این لینک معتبر نیست یا حذف شده است.</div></body>');
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}

/* ---- خطای دیتابیس ---- */
function dbErr(res, html) {
  if (html) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Tahoma;background:#0f1216;color:#e8e6e3;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div>خطای سرور — تنظیمات Supabase را بررسی کن.</div></body>');
  } else {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('error');
  }
}

/* ---- صفحه‌ی خوانا برای مرورگر ---- */
function esc(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function htmlPage(res, text) {
  const lines = (text || '').split('\n').filter(l => l.trim());
  const list = lines.length
    ? lines.map(l => `<li><code>${esc(l)}</code></li>`).join('')
    : '<li><code style="color:#9aa4af">— این بخش خالی است —</code></li>';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Sub Panel</title>
<style>body{font-family:Vazirmatn,Tahoma,sans-serif;background:#0f1216;color:#e8e6e3;margin:0;padding:24px}
.wrap{max-width:720px;margin:0 auto}h1{font-size:18px}p{color:#9aa4af;font-size:13px}
ul{list-style:none;padding:0}li{background:#161b22;border:1px solid #262d37;border-radius:10px;padding:10px 14px;margin:8px 0}
code{font-family:ui-monospace,Consolas,monospace;font-size:12px;direction:ltr;display:block;text-align:left;word-break:break-all;color:#8fd3a0}</style></head>
<body><div class="wrap"><h1>Subscription — Sub Panel</h1>
<p>این صفحه فقط برای مشاهده در مرورگر است؛ اپ‌ها (v2rayNG / PattNG) همین آدرس را به‌صورت خودکار دریافت می‌کنند.</p>
<ul>${list}</ul></div></body></html>`);
}
