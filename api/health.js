const { getSupabaseConfig, supabaseRequest } = require('../lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return done(res, 405, { ok: false, error: 'method' });

  const config = getSupabaseConfig();
  if (!config.ok) {
    return done(res, 503, {
      ok: false,
      supabase: 'configuration_missing',
      missing: config.missing,
    });
  }

  try {
    await supabaseRequest('/rest/v1/users?select=id&limit=0');
  } catch (error) {
    return done(res, 502, { ok: false, supabase: classify(error) });
  }
  try {
    // Columns added in v1.3 (custom link name + expiry). Missing => run schema.sql again.
    await supabaseRequest('/rest/v1/sections?select=id,slug,expires_at&limit=0');
    return done(res, 200, { ok: true, supabase: 'connected' });
  } catch (error) {
    const s = classify(error);
    return done(res, 502, { ok: false, supabase: s === 'bad_request' || s === 'users_table_missing' ? 'schema_outdated' : s,
      hint: 'run schema.sql again in Supabase SQL Editor' });
  }
};

function classify(error) {
  if (error && error.status === 401) return 'key_rejected';
  if (error && error.status === 403) return 'permission_denied';
  if (error && error.status === 404) return 'users_table_missing';
  if (error && error.status === 400) return 'bad_request';
  if (error && error.status >= 500) return 'service_error';
  return 'unreachable';
}

function done(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
