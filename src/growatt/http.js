// -----------------------------------------------------------------------------
// One HTTP exchange with the Growatt cloud, through an injectable `fetch`
// (the tests pass a fake server: they never touch the network).
// -----------------------------------------------------------------------------

import { ERROR_CODES, GrowattError } from './errors.js';

export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {RequestInit} init
 * @returns {Promise<{ status: number, headers: Headers, text: string, json: unknown }>}
 *   `json` is undefined when the body is not JSON (an HTML login page...)
 */
export async function exchange(fetchImpl, url, init = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // The URL is the server and the endpoint: no credential in it, ever
    // (the token travels in a header, the password in the body).
    const reason = err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? err?.message);
    throw new GrowattError(ERROR_CODES.NETWORK, `${endpointOf(url)}: ${reason}`);
  }
  const text = await response.text();
  let json;
  try {
    json = text === '' ? undefined : JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, headers: response.headers, text, json };
}

/** "https://openapi.growatt.com/v1/plant/list?x=1" → "v1/plant/list", for the messages. */
export function endpointOf(url) {
  try {
    const { pathname } = new URL(url);
    return pathname.replace(/^\/+/, '');
  } catch {
    return 'request';
  }
}

/** A form body (application/x-www-form-urlencoded), from a flat object. */
export function form(fields) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) {
      body.set(key, String(value));
    }
  }
  return body;
}
