// Shared rules for subscription links: custom names (slugs) and expiry.
const KEY_RE = /^[a-f0-9]{16}$/;
// 3-32 chars: lowercase latin letters, digits, "-" and "_"; must start/end with a letter or digit.
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]$/;
const RESERVED = new Set(['api', 'admin', 'login', 'health', 'sub', 'subs', 'panel', 'public']);
const MAX_DAYS = 3650;
const DAY_MS = 86400000;

function normSlug(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

// Returns null when the slug is acceptable, otherwise an error code.
// An empty slug is valid and means "remove the custom name".
function slugError(slug) {
  if (!slug) return null;
  if (slug.length < 3 || slug.length > 32) return 'slug_len';
  if (!SLUG_RE.test(slug)) return 'slug_chars';
  if (KEY_RE.test(slug)) return 'slug_chars'; // would collide with random link keys
  if (RESERVED.has(slug)) return 'slug_taken';
  return null;
}

function isKey(seg) { return KEY_RE.test(String(seg || '')); }
function isSlug(seg) { const s = String(seg || ''); return !!s && slugError(s) === null; }

// Days must be a whole number from 0 to MAX_DAYS. 0 = no time limit. Returns null if invalid.
function parseDays(v) {
  if (v === '' || v == null || typeof v === 'boolean') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > MAX_DAYS) return null;
  return n;
}

function expiryFromDays(days, now = Date.now()) {
  return days === 0 ? null : new Date(now + days * DAY_MS).toISOString();
}

function isExpired(expiresAt, now = Date.now()) {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t <= now;
}

function daysLeft(expiresAt, now = Date.now()) {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.ceil((t - now) / DAY_MS));
}

module.exports = {
  KEY_RE, SLUG_RE, MAX_DAYS,
  normSlug, slugError, isKey, isSlug, parseDays, expiryFromDays, isExpired, daysLeft,
};
