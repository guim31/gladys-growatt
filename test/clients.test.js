// -----------------------------------------------------------------------------
// The two Growatt clients against the fake cloud: requests, error mapping,
// and the ShinePhone session rules (reuse, one re-login, lockout).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ClassicClient,
  LOGIN_MIN_GAP_MS,
  SHINEPHONE_USER_AGENT,
  hashPassword,
} from '../src/growatt/classic.js';
import { ERROR_CODES } from '../src/growatt/errors.js';
import { OpenApiClient } from '../src/growatt/openapi.js';
import { describeAnswer } from '../src/growatt/http.js';
import { SERVERS } from '../src/config.js';
import { PASSWORD, TOKEN, USERNAME, createFakeGrowatt, fixture } from './helpers/fakeGrowatt.js';

const server = SERVERS.europe;

test('the ShinePhone password hash (growattServer hash_password)', () => {
  // Reference values computed with the Python library's algorithm.
  assert.equal(hashPassword('secret'), '5ebe2294ecd0e0f08eab7690d2a6ee69');
  assert.equal(hashPassword('Growatt!2026'), '2cf36924c59271c9ab3ef322706dc7b8');
});

test('OpenAPI: the token travels in a header, plants and devices are mapped', async () => {
  const growatt = createFakeGrowatt();
  const client = new OpenApiClient({ server, token: TOKEN, fetch: growatt.fetch });
  assert.deepEqual(await client.listPlants(), [{ id: '1234567', name: 'Maison' }]);
  const devices = await client.listDevices('1234567');
  assert.deepEqual(
    devices.map((d) => [d.sn, d.family, d.detailed, d.status]),
    [
      ['MIN0A1B2C3', 'min', true, 'normal'],
      ['SPH9Z8Y7X6', 'sph', true, 'normal'],
      ['INV4D5E6F7', 'inverter', false, 'offline'],
    ],
  );
  const [request] = growatt.requests;
  assert.equal(request.headers.get('token'), TOKEN);
  assert.ok(!request.url.toString().includes(TOKEN), 'never in the URL');
  assert.equal(request.url.host, 'openapi.growatt.com');
});

test('OpenAPI: error codes become the right failures', async () => {
  const cases = [
    ['openapi/error-no-privilege.json', ERROR_CODES.AUTH],
    ['openapi/error-rate-limited.json', ERROR_CODES.RATE_LIMITED],
    ['openapi/error-wrong-domain.json', ERROR_CODES.AUTH],
    [{ error_code: 10001, error_msg: 'system error' }, ERROR_CODES.PROTOCOL],
    [new Response('<html>maintenance</html>', { status: 200 }), ERROR_CODES.PROTOCOL],
    [new Response('busy', { status: 503 }), ERROR_CODES.NETWORK],
    [new Response('no', { status: 401 }), ERROR_CODES.AUTH],
  ];
  for (const [answer, code] of cases) {
    const growatt = createFakeGrowatt({ routes: { 'v1/plant/list': answer } });
    const client = new OpenApiClient({ server, token: TOKEN, fetch: growatt.fetch });
    await assert.rejects(client.listPlants(), (err) => err.code === code, JSON.stringify(code));
  }
});

test('OpenAPI: a wrong token is refused, a network failure says nothing secret', async () => {
  const growatt = createFakeGrowatt();
  const wrong = new OpenApiClient({ server, token: 'wrong', fetch: growatt.fetch });
  await assert.rejects(wrong.listPlants(), { code: ERROR_CODES.AUTH });

  const down = new OpenApiClient({
    server,
    token: TOKEN,
    fetch: async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    },
  });
  await assert.rejects(down.listPlants(), (err) => {
    assert.equal(err.code, ERROR_CODES.NETWORK);
    assert.equal(err.message, 'v1/plant/list: ECONNREFUSED');
    return true;
  });
});

test('OpenAPI: an SPH is read from its detail and its last data', async () => {
  const growatt = createFakeGrowatt();
  const client = new OpenApiClient({ server, token: TOKEN, fetch: growatt.fetch });
  const reading = await client.readDevice({ sn: 'SPH9Z8Y7X6', family: 'sph' });
  assert.equal(reading.battery_level, 64);
  assert.equal(reading.production_total, 10422.8);
  assert.equal(growatt.calls('v1/device/mix/mix_last_data')[0].body.get('mix_sn'), 'SPH9Z8Y7X6');
});

function classic(growatt, options = {}) {
  let saved = null;
  let clock = options.start ?? 1_000_000_000_000;
  const client = new ClassicClient({
    server,
    username: USERNAME,
    password: PASSWORD,
    session: options.session ?? null,
    onSession: (session) => {
      saved = session;
    },
    fetch: growatt.fetch,
    now: () => clock,
  });
  return {
    client,
    saved: () => saved,
    advance: (ms) => {
      clock += ms;
    },
  };
}

test('ShinePhone: the login sends the hashed password, and the session is kept', async () => {
  const growatt = createFakeGrowatt();
  const { client, saved } = classic(growatt);
  assert.deepEqual(await client.listPlants(), [{ id: '1234567', name: 'Maison' }]);
  const [login] = growatt.calls('newTwoLoginAPI.do');
  assert.equal(login.body.get('password'), hashPassword(PASSWORD));
  assert.ok(!String(login.body).includes(encodeURIComponent(PASSWORD)), 'no clear password');
  assert.equal(login.headers.get('user-agent'), SHINEPHONE_USER_AGENT);
  assert.deepEqual(saved().cookies, { JSESSIONID: 'S1' });
  assert.equal(saved().userId, '7654321');
  assert.ok(!JSON.stringify(saved()).includes(PASSWORD), 'the password is never saved');

  // Another client (a restart) with the saved session: no login.
  const again = classic(growatt, { session: saved() });
  const devices = await again.client.listDevices('1234567');
  assert.equal(devices.length, 4);
  assert.equal(growatt.calls('newTwoLoginAPI.do').length, 1);
  assert.deepEqual(
    devices.map((d) => [d.sn, d.family, d.detailed, d.name]),
    [
      ['TLX0A1B2C3', 'tlx', true, 'Garage'],
      ['MIX9Z8Y7X6', 'mix', true, undefined],
      ['INV4D5E6F7', 'inverter', true, undefined],
      ['NOAH000001', 'noah', false, 'Balcon'],
    ],
  );
});

test('ShinePhone: an expired session is renewed once, then held back', async () => {
  const growatt = createFakeGrowatt();
  const { client, advance } = classic(growatt);
  await client.readPlant('1234567');
  growatt.expireSessions();
  advance(LOGIN_MIN_GAP_MS + 1);
  // The redirect to the login page: one new login, the request again.
  const plant = await client.readPlant('1234567');
  assert.equal(plant.production_total, 8456.3);
  assert.equal(growatt.calls('newTwoLoginAPI.do').length, 2);

  // Expired again a minute later: no third login so soon.
  growatt.expireSessions();
  advance(60_000);
  await assert.rejects(client.readPlant('1234567'), { code: ERROR_CODES.SESSION });
  assert.equal(growatt.calls('newTwoLoginAPI.do').length, 2);
});

test('ShinePhone: an unknown account (msg 501) is refused credentials', async () => {
  const growatt = createFakeGrowatt({
    routes: { 'newTwoLoginAPI.do': { back: { success: false, msg: '501' } } },
  });
  const { client } = classic(growatt);
  await assert.rejects(client.listPlants(), { code: ERROR_CODES.AUTH, apiCode: '501' });
});

test('ShinePhone: a wrong password and a locked account', async () => {
  const wrong = createFakeGrowatt();
  const bad = new ClassicClient({
    server,
    username: USERNAME,
    password: 'not-the-password',
    fetch: wrong.fetch,
  });
  await assert.rejects(bad.listPlants(), { code: ERROR_CODES.AUTH });

  const locked = createFakeGrowatt({
    routes: { 'newTwoLoginAPI.do': 'shinephone/login-locked.json' },
  });
  const { client } = classic(locked);
  await assert.rejects(client.listPlants(), { code: ERROR_CODES.LOCKED });

  // A data page can answer 507 too (Growatt limits every endpoint).
  const growatt = createFakeGrowatt({
    routes: { 'newTwoPlantAPI.do?getAllDeviceListTwo': { back: { success: false, msg: '507' } } },
  });
  const other = classic(growatt);
  await assert.rejects(other.client.readPlant('1234567'), { code: ERROR_CODES.LOCKED });
});

test('ShinePhone: the detailed families', async () => {
  const growatt = createFakeGrowatt();
  const { client } = classic(growatt);
  const tlx = await client.readDevice({ sn: 'TLX0A1B2C3', family: 'tlx', plantId: '1' });
  assert.equal(tlx.battery_level, 76);
  const mix = await client.readDevice({ sn: 'MIX9Z8Y7X6', family: 'mix', plantId: '1' });
  assert.equal(mix.pv_power, 2870);
  const inverter = await client.readDevice({ sn: 'INV4D5E6F7', family: 'inverter', plantId: '1' });
  assert.equal(inverter.production_total, 21345.6);
  assert.equal(
    growatt.calls('newInverterAPI.do?getInverterDetailData')[0].url.searchParams.get('inverterId'),
    'INV4D5E6F7',
  );
  assert.ok(fixture('shinephone/plant-info.json').deviceList.length === 4);
});

test('ShinePhone: a login refused with HTTP 403 is "blocked", not a network failure', async () => {
  const page = new Response(
    '<html><head><title>Attention Required! | Cloudflare</title></head></html>',
    {
      status: 403,
      headers: { 'content-type': 'text/html; charset=UTF-8' },
    },
  );
  const growatt = createFakeGrowatt({ routes: { 'newTwoLoginAPI.do': () => page.clone() } });
  const { client } = classic(growatt);
  await assert.rejects(client.listPlants(), (err) => {
    assert.equal(err.code, ERROR_CODES.BLOCKED);
    assert.equal(err.httpStatus, 403);
    assert.match(err.message, /HTTP 403 \(html "Attention Required! \| Cloudflare"\)/);
    return true;
  });
  // The only User-Agent Growatt accepts there: the app's.
  const [login] = growatt.calls('newTwoLoginAPI.do');
  assert.equal(
    login.headers.get('user-agent'),
    'ShinePhone/8.1.17 (iPhone; iOS 15.6.1; Scale/2.00)',
  );
  assert.equal(login.headers.get('accept'), '*/*');
});

test('the kind of an answer is described without its body', () => {
  const answer = (text, type = 'text/plain') => ({
    text,
    json: undefined,
    headers: new Headers({ 'content-type': type }),
  });
  assert.equal(describeAnswer({ ...answer('{}'), json: {} }), 'json');
  assert.equal(describeAnswer(answer('  ')), 'empty');
  assert.equal(
    describeAnswer(answer('<title>Just a\n moment...</title>')),
    'html "Just a moment..."',
  );
  assert.equal(describeAnswer(answer('<p>no</p>', 'text/html')), 'html');
  assert.equal(describeAnswer(answer('forbidden')), 'text');
});
