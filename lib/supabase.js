const KEY_ENV_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_SECRET_KEY',
];

function getSupabaseConfig(env = process.env) {
  const rawUrl = String(env.SUPABASE_URL || '').trim();
  const url = rawUrl.replace(/\/+$/, '');
  const keyName = KEY_ENV_NAMES.find(name => String(env[name] || '').trim());
  const key = keyName ? String(env[keyName]).trim() : '';
  const missing = [];

  if (!url) missing.push('SUPABASE_URL');
  if (!key) {
    missing.push(
      'SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY / SUPABASE_SECRET_KEY)'
    );
  }

  let invalidUrl = false;
  if (url) {
    try {
      const parsed = new URL(url);
      invalidUrl = !['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname;
    } catch {
      invalidUrl = true;
    }
  }
  if (invalidUrl) missing.push('SUPABASE_URL must be a valid http(s) URL');

  return { url, key, keyName, missing, ok: missing.length === 0 };
}

async function supabaseRequest(path, options = {}) {
  const config = getSupabaseConfig();
  if (!config.ok) {
    const error = new Error('supabase_not_configured');
    error.code = 'SUPABASE_NOT_CONFIGURED';
    throw error;
  }

  const method = String(options.method || 'GET').toUpperCase();
  const resource = String(path).split(/[?#]/, 1)[0];
  try {
    const response = await fetch(config.url + path, {
      ...options,
      headers: {
        apikey: config.key,
        Authorization: 'Bearer ' + config.key,
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      const error = new Error('supabase_http_error');
      error.code = 'SUPABASE_HTTP_ERROR';
      error.status = response.status;
      console.error('[supabase] request failed', {
        method,
        resource,
        status: response.status,
      });
      throw error;
    }
    return await response.json().catch(() => []);
  } catch (error) {
    if (error && error.code === 'SUPABASE_HTTP_ERROR') throw error;
    console.error('[supabase] request failed', {
      method,
      resource,
      status: 'network',
    });
    const wrapped = new Error('supabase_network_error');
    wrapped.code = 'SUPABASE_NETWORK_ERROR';
    throw wrapped;
  }
}

module.exports = { getSupabaseConfig, supabaseRequest };
