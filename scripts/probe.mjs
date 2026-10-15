#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real Growatt cloud, read only, with the integration's own
// clients (src/growatt/). Run it from a machine that has network access:
//
//   node scripts/probe.mjs                 fake credentials: the real requests,
//                                          down to Growatt's refusal, and what the
//                                          ShinePhone login answers (status, type
//                                          of body) for three User-Agents
//   GROWATT_TOKEN=... node scripts/probe.mjs
//   GROWATT_USERNAME=... GROWATT_PASSWORD=... node scripts/probe.mjs
//                                          a real account: plants, devices and
//                                          normalized readings, read only
//   GROWATT_SERVER=north_america ...       another region (europe by default)
//
// Nothing sensitive is printed: no token, no password, no cookie, no body;
// plant ids and serial numbers are masked, names are left out. A real
// ShinePhone account is logged in ONCE per run (Growatt locks accounts that
// log in too often).
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { SERVERS } from '../src/config.js';
import { ClassicClient, hashPassword } from '../src/growatt/classic.js';
import { ERROR_CODES } from '../src/growatt/errors.js';
import { describeAnswer, exchange, form } from '../src/growatt/http.js';
import { OpenApiClient } from '../src/growatt/openapi.js';

const region = process.env.GROWATT_SERVER ?? 'europe';
const server = SERVERS[region];
if (!server) {
  console.error(`Unknown GROWATT_SERVER "${region}" (one of ${Object.keys(SERVERS).join(', ')})`);
  process.exit(2);
}

const mask = (id) => {
  const text = String(id);
  return text.length <= 4 ? '***' : `${text.slice(0, 3)}***${text.slice(-1)}`;
};
const print = (label, value) => console.log(`${label}: ${JSON.stringify(value)}`);
const fakeName = () => `gladys-probe-${randomBytes(6).toString('hex')}`;

let failures = 0;
async function expectRefusal(label, run, expected) {
  try {
    await run();
    print(label, 'UNEXPECTED: accepted');
    failures += 1;
  } catch (err) {
    const ok = expected.includes(err.code);
    print(label, {
      code: err.code,
      apiCode: err.apiCode ?? null,
      httpStatus: err.httpStatus ?? null,
      ok,
    });
    if (!ok) {
      print(`${label} message`, err.message);
      failures += 1;
    }
  }
}

/** Plants, devices and one reading of each, read only, masked. */
async function readAccount(client) {
  const plants = await client.listPlants();
  print('plants', plants.length);
  for (const plant of plants) {
    const { devices: fromPage, ...plantReading } = await client.readPlant(plant.id);
    print(`plant ${mask(plant.id)}`, plantReading);
    const devices = fromPage ?? (await client.listDevices(plant.id));
    for (const device of devices) {
      print(`device ${mask(device.sn)}`, {
        family: device.family,
        detailed: device.detailed,
        status: device.status,
        lost: device.lost,
        model: device.model ?? null,
      });
      if (device.detailed) {
        try {
          print(`reading ${mask(device.sn)}`, await client.readDevice(device));
        } catch (err) {
          print(`reading ${mask(device.sn)} failed`, { code: err.code, message: err.message });
        }
      }
    }
  }
}

/**
 * What the ShinePhone server answers to a login with a fake account, by
 * User-Agent: the integration's, growattServer's default, and the iOS app's
 * (growattServer examples). Status and headers only; the body is described
 * ("json", "html <title>"...), never printed.
 */
async function shinePhoneDiagnosis() {
  const variants = {
    integration: new ClassicClient({
      server,
      username: '',
      password: '',
      agentId: '10000',
    }).headers(),
    growattServer: {
      'User-Agent':
        'Dalvik/2.1.0 (Linux; U; Android 12; https://github.com/indykoning/PyPi_GrowattServer)',
      Accept: '*/*',
    },
    shinePhoneIos: {
      'User-Agent': 'ShinePhone/8.1.17 (iPhone; iOS 15.6.1; Scale/2.00)',
      Accept: '*/*',
    },
  };
  for (const [label, headers] of Object.entries(variants)) {
    const what = `shinephone login, user agent ${label}`;
    try {
      const answer = await exchange(globalThis.fetch, `${server}newTwoLoginAPI.do`, {
        method: 'POST',
        headers,
        body: form({
          userName: fakeName(),
          password: hashPassword(randomBytes(12).toString('hex')),
        }),
        redirect: 'manual',
      });
      print(what, {
        status: answer.status,
        contentType: answer.headers.get('content-type'),
        server: answer.headers.get('server'),
        cloudflare: answer.headers.has('cf-ray'),
        location: answer.headers.has('location')
          ? new URL(answer.headers.get('location'), server).host
          : null,
        answer: describeAnswer(answer),
        msg: answer.json?.back?.msg ?? null,
      });
    } catch (err) {
      print(what, { code: err.code, message: err.message });
    }
  }
}

console.log(`Growatt probe, server ${region} (${server})`);

if (process.env.GROWATT_TOKEN) {
  await readAccount(new OpenApiClient({ server, token: process.env.GROWATT_TOKEN.trim() }));
} else if (process.env.GROWATT_USERNAME && process.env.GROWATT_PASSWORD) {
  await readAccount(
    new ClassicClient({
      server,
      username: process.env.GROWATT_USERNAME.trim(),
      password: process.env.GROWATT_PASSWORD,
      agentId: String(10000 + (randomBytes(2).readUInt16BE() % 90000)),
    }),
  );
} else {
  // Fake credentials: every request is real, down to Growatt's refusal.
  await expectRefusal(
    'openapi plant/list with a fake token',
    () =>
      new OpenApiClient({
        server,
        token: `gladys-probe-${randomBytes(12).toString('hex')}`,
      }).listPlants(),
    [ERROR_CODES.AUTH],
  );
  await expectRefusal(
    'shinephone login with a fake account',
    () =>
      new ClassicClient({
        server,
        username: fakeName(),
        password: randomBytes(12).toString('hex'),
        agentId: '10000',
      }).listPlants(),
    // 502 wrong account; 507 if Growatt rate-limits the probe machine; 403
    // (blocked) if the server refuses the login request itself.
    [ERROR_CODES.AUTH, ERROR_CODES.LOCKED, ERROR_CODES.BLOCKED],
  );
  await shinePhoneDiagnosis();
}

process.exit(failures === 0 ? 0 : 1);
