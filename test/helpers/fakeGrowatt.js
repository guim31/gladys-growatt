// -----------------------------------------------------------------------------
// A fake Growatt cloud, served through an injected `fetch`: the tests never
// touch the network. It answers the OpenAPI V1 and the ShinePhone endpoints
// the integration uses with the fixtures of test/fixtures/, and plays the
// rules of the real cloud that matter here:
//
//   - OpenAPI: the `token` header is checked (10011 otherwise), and the same
//     endpoint called again within 5 minutes answers 10012;
//   - ShinePhone: the login checks the hashed password and sets a session
//     cookie; any other page without a valid cookie redirects to the login
//     page (an expired session); a scripted login can answer 502 or 507.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { hashPassword } from '../../src/growatt/classic.js';

export const TOKEN = 'fake-openapi-token-0123456789';
export const USERNAME = 'solar-owner';
export const PASSWORD = 'S3cret-Pass!';

export function fixture(path) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${path}`, import.meta.url), 'utf8'));
}

const OPENAPI_ROUTES = {
  'v1/plant/list': 'openapi/plant-list.json',
  'v1/plant/data': 'openapi/plant-data.json',
  'v1/plant/power': 'openapi/plant-power.json',
  'v1/device/list': 'openapi/device-list.json',
  'v1/device/tlx/tlx_last_data': 'openapi/tlx-last-data.json',
  'v1/device/mix/mix_data_info': 'openapi/mix-data-info.json',
  'v1/device/mix/mix_last_data': 'openapi/mix-last-data.json',
};

const SHINEPHONE_ROUTES = {
  'newTwoLoginAPI.do': 'shinephone/login-ok.json',
  'PlantListAPI.do': () => ({ back: { data: fixture('shinephone/login-ok.json').back.data } }),
  'newTwoPlantAPI.do?getAllDeviceListTwo': 'shinephone/plant-info.json',
  'newTwoPlantAPI.do?getAllDeviceList': () => ({
    deviceList: fixture('shinephone/plant-info.json').deviceList,
  }),
  'newInverterAPI.do?getInverterDetailData': 'shinephone/inverter-detail.json',
  'newTlxApi.do?getTlxDetailData': 'shinephone/tlx-detail.json',
  'newMixApi.do?getSystemStatus_KW': 'shinephone/mix-status.json',
  'newMixApi.do?getEnergyOverview': 'shinephone/mix-totals.json',
};

/**
 * @param {object} [options]
 * @param {() => number} [options.now] the clock of the rate limit
 * @param {Record<string, string|object|Function>} [options.routes] overrides by route key
 */
export function createFakeGrowatt({ now = () => Date.now(), routes = {} } = {}) {
  const table = { ...OPENAPI_ROUTES, ...SHINEPHONE_ROUTES, ...routes };
  const sessions = new Set();
  const lastCall = new Map();
  /** Every request: { method, route, url, headers, body }. */
  const requests = [];
  let sessionCounter = 0;
  let rateLimited = 0;

  function answer(entry, request) {
    let body = entry;
    if (typeof entry === 'function') {
      body = entry(request);
    } else if (typeof entry === 'string') {
      body = fixture(entry);
    }
    if (body instanceof Response) {
      return body;
    }
    return Response.json(body);
  }

  async function fakeFetch(input, init = {}) {
    const url = new URL(String(input));
    const headers = new Headers(init.headers ?? {});
    const body = init.body ? new URLSearchParams(String(init.body)) : new URLSearchParams();
    const path = url.pathname.replace(/^\/+/, '');
    const op = url.searchParams.get('op') ?? body.get('op');
    const route = op ? `${path}?${op}` : path;
    const request = { method: init.method ?? 'GET', route, url, headers, body };
    requests.push(request);

    if (path.startsWith('v1/')) {
      if (headers.get('token') !== TOKEN) {
        return Response.json(fixture('openapi/error-no-privilege.json'));
      }
      // The 5-minute rule of the cloud, per endpoint and parameters.
      const key = `${route}?${url.searchParams}&${body}`;
      if (lastCall.has(key) && now() - lastCall.get(key) < 5 * 60_000) {
        rateLimited += 1;
        return Response.json(fixture('openapi/error-rate-limited.json'));
      }
      lastCall.set(key, now());
    } else if (route === 'newTwoLoginAPI.do') {
      const entry = table[route];
      if (entry !== SHINEPHONE_ROUTES[route]) {
        return answer(entry, request);
      }
      if (body.get('userName') !== USERNAME || body.get('password') !== hashPassword(PASSWORD)) {
        return Response.json(fixture('shinephone/login-bad-password.json'));
      }
      sessionCounter += 1;
      const session = `S${sessionCounter}`;
      sessions.add(session);
      return Response.json(fixture('shinephone/login-ok.json'), {
        headers: { 'set-cookie': `JSESSIONID=${session}; Path=/; HttpOnly` },
      });
    } else {
      const cookie = headers.get('cookie') ?? '';
      const session = cookie.match(/JSESSIONID=([^;]+)/)?.[1];
      if (!session || !sessions.has(session)) {
        // An expired session: the server sends the browser to its login page.
        return new Response('', { status: 302, headers: { location: '/login' } });
      }
    }

    const entry = table[route];
    if (entry === undefined) {
      return new Response('not found', { status: 404 });
    }
    return answer(entry, request);
  }

  return {
    fetch: fakeFetch,
    requests,
    /** Requests of one route (e.g. 'v1/plant/data', 'newTwoLoginAPI.do'). */
    calls: (route) => requests.filter((request) => request.route === route),
    /** How many requests were refused by the 5-minute rule. */
    rateLimited: () => rateLimited,
    /** Replace the answer of a route. */
    set(route, entry) {
      table[route] = entry;
    },
    /** Every ShinePhone session expires (the server restarted). */
    expireSessions() {
      sessions.clear();
    },
  };
}
