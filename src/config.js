// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user from the `config_schema` of the manifest. This module
// provides the defaults (they MUST match the manifest `default` values, see
// test/manifest.test.js) and normalizes the received object, so the rest of
// the code never deals with `undefined` or with numbers typed as strings.
// -----------------------------------------------------------------------------

/** The languages of the Gladys interface, in this order. */
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/**
 * The Growatt servers, by region. The OpenAPI (token) lives under `v1/`, the
 * ShinePhone API (account) at the root of the same host: one choice serves
 * both. These are the servers of the Home Assistant integration; the former
 * `server.growatt.com` hosts redirect there.
 */
export const SERVERS = {
  europe: 'https://openapi.growatt.com/',
  north_america: 'https://openapi-us.growatt.com/',
  australia: 'https://openapi-au.growatt.com/',
  china: 'https://openapi-cn.growatt.com/',
};

/**
 * Refresh intervals offered, in minutes. Growatt dataloggers upload every
 * 5 minutes, and the cloud refuses an endpoint called twice within 5 minutes
 * (OpenAPI error 10012): reading faster would only return the same data, or
 * nothing.
 */
export const REFRESH_MINUTES = [5, 10, 15, 30];

export const DEFAULT_CONFIG = {
  auth_mode: 'token', // 'token' (OpenAPI V1, recommended) | 'password' (ShinePhone account)
  api_token: '',
  username: '',
  password: '',
  server: 'europe',
  plant_ids: '', // empty: every plant of the account; else ids separated by commas
  refresh_minutes: '5', // a select: the value is a string
  language: 'fr',
};

/**
 * Merge the user config with the defaults and fix the types.
 * @param {Record<string, unknown>} [raw]
 */
export function normalizeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG, ...(raw ?? {}) };
  const refresh = Number(config.refresh_minutes);
  return {
    auth_mode: config.auth_mode === 'password' ? 'password' : 'token',
    // A token pasted with spaces or a line break around it is still the token.
    api_token: String(config.api_token ?? '').trim(),
    username: String(config.username ?? '').trim(),
    // A password is kept as typed: spaces may be part of it.
    password: String(config.password ?? ''),
    server: Object.hasOwn(SERVERS, config.server) ? config.server : DEFAULT_CONFIG.server,
    plant_ids: parsePlantIds(config.plant_ids),
    refresh_minutes: REFRESH_MINUTES.includes(refresh)
      ? refresh
      : Number(DEFAULT_CONFIG.refresh_minutes),
    language: LANGUAGES.includes(config.language) ? config.language : DEFAULT_CONFIG.language,
  };
}

/** "123, 456" → ['123', '456']; anything else than digits is dropped. */
function parsePlantIds(raw) {
  return String(raw ?? '')
    .split(/[\s,;]+/)
    .map((id) => id.trim())
    .filter((id) => /^\d+$/.test(id));
}

/** The credentials the chosen mode needs are filled in. */
export function isConfigured(config) {
  return config.auth_mode === 'token'
    ? config.api_token !== ''
    : config.username !== '' && config.password !== '';
}

/** The server base URL, with its trailing slash. */
export function serverUrl(config) {
  return SERVERS[config.server] ?? SERVERS.europe;
}

/**
 * The secrets of a config, so the logs and the messages can be checked
 * against them (test/logs.test.js) and scrubbed.
 */
export function secretsOf(config) {
  return [config.api_token, config.password].filter((secret) => secret && secret.length >= 4);
}

/**
 * The period of the container's own timer, in ms: the configured interval,
 * plus a margin so that two reads of the same endpoint are always more than
 * 5 minutes apart, whatever the jitter of the timer and of the requests.
 */
export function refreshPeriodMs(config) {
  return config.refresh_minutes * 60_000 + 20_000;
}
