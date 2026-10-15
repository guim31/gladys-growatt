#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real Growatt cloud, read only, with the integration's own
// clients (src/growatt/). Run it from a machine that has network access:
//
//   node scripts/probe.mjs                 fake credentials: the real requests,
//                                          down to Growatt's refusal, and what the
//                                          ShinePhone login answers (status, type
//                                          of body) for two User-Agents
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
      refused: err.code === ERROR_CODES.AUTH ? 'credentials' : err.code,
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
 * User-Agent: the integration's (the iOS app's, the only one Growatt accepts)
 * and growattServer's Android default (refused with HTTP 403 on 15/10/2026). Status and headers only; the body is described
 * ("json", "html <title>"...), never printed.
 */
async function shinePhoneDiagnosis() {
  const variants = {
    integration: new ClassicClient({
      server,
      username: '',
      password: '',
    }).headers(),
    growattServer: {
      'User-Agent':
        'Dalvik/2.1.0 (Linux; U; Android 12; https://github.com/indykoning/PyPi_GrowattServer)',
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
      }).listPlants(),
    // The normal answer to an unknown account: msg 501, credentials refused.
    [ERROR_CODES.AUTH],
  );
  await shinePhoneDiagnosis();
}

process.exit(failures === 0 ? 0 : 1);
