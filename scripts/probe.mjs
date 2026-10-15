#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real Growatt cloud, read only, with the integration's own
// clients (src/growatt/). Run it from a machine that has network access:
//
//   node scripts/probe.mjs                 fake credentials: the real requests,
//                                          down to Growatt's refusal
//   GROWATT_TOKEN=... node scripts/probe.mjs
//   GROWATT_USERNAME=... GROWATT_PASSWORD=... node scripts/probe.mjs
//                                          a real account: plants, devices and
//                                          normalized readings, read only
//   GROWATT_SERVER=north_america ...       another region (europe by default)
//
// Nothing sensitive is printed: no token, no password, no cookie; plant ids
// and serial numbers are masked, names are left out. A ShinePhone login is
// attempted ONCE per run (Growatt locks accounts that log in too often).
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { SERVERS } from '../src/config.js';
import { ClassicClient } from '../src/growatt/classic.js';
import { ERROR_CODES } from '../src/growatt/errors.js';
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

let failures = 0;
async function expectRefusal(label, run, expected) {
  try {
    await run();
    print(label, 'UNEXPECTED: accepted');
    failures += 1;
  } catch (err) {
    const ok = expected.includes(err.code);
    print(label, { code: err.code, apiCode: err.apiCode ?? null, ok });
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
    const totals = await client.readPlant(plant.id);
    const { devices: fromPage, ...plantReading } = totals;
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
  const fakeToken = `gladys-probe-${randomBytes(12).toString('hex')}`;
  await expectRefusal(
    'openapi plant/list with a fake token',
    () => new OpenApiClient({ server, token: fakeToken }).listPlants(),
    [ERROR_CODES.AUTH],
  );
  await expectRefusal(
    'shinephone login with a fake account',
    () =>
      new ClassicClient({
        server,
        username: `gladys-probe-${randomBytes(6).toString('hex')}`,
        password: randomBytes(12).toString('hex'),
        agentId: '10000',
      }).listPlants(),
    // 502 wrong account; 507 if Growatt rate-limits the probe machine.
    [ERROR_CODES.AUTH, ERROR_CODES.LOCKED],
  );
}

process.exit(failures === 0 ? 0 : 1);
