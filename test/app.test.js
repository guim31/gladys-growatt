// -----------------------------------------------------------------------------
// The integration end to end: the SDK's fake Gladys, the fake Growatt cloud.
// Discovery, states once a device is added, the container's own timer (no
// onPoll needed), the Growatt limits, the status trigger, the refusals and
// the lockout, the session kept across restarts.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEXT } from '../src/i18n.js';
import { refreshPeriodMs, normalizeConfig } from '../src/config.js';
import { Store } from '../src/store.js';
import {
  PASSWORD_CONFIG,
  TOKEN_CONFIG,
  addAll,
  createWorld,
  findDevice,
  stateOf,
} from './helpers/world.js';
import { fixture } from './helpers/fakeGrowatt.js';

const PERIOD = refreshPeriodMs(normalizeConfig(TOKEN_CONFIG));

/** Let the promises of a timer callback settle. */
async function settle(rounds = 30) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test('discovery: the plant and its detailed inverters, no state before they are added', async () => {
  const { gladys, growatt, integration } = await createWorld();
  try {
    const names = gladys.fake.discoveredDevices.map((device) => device.name);
    assert.deepEqual(names, ['Maison', 'Growatt MIN MIN0A1B2C3', 'Growatt SPH SPH9Z8Y7X6']);
    assert.equal(gladys.fake.states.length, 0, 'Gladys drops the states of devices not added');
    assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
    // The old inverter (OpenAPI type 1) is counted in the plant totals only.
    assert.equal(findDevice(gladys, 'INV4D5E6F7'), undefined);
    assert.equal(growatt.calls('v1/plant/list').length, 1);
  } finally {
    await integration.stop();
  }
});

test('a device added in Gladys gets its states at once, from the readings just made', async () => {
  const { gladys, growatt, integration } = await createWorld();
  try {
    const before = growatt.requests.length;
    await addAll(gladys);
    const plant = findDevice(gladys, 'plant:');
    const min = findDevice(gladys, 'MIN0A1B2C3');
    const sph = findDevice(gladys, 'SPH9Z8Y7X6');
    assert.equal(stateOf(gladys, plant, 'power'), 2456);
    assert.equal(stateOf(gladys, plant, 'production_total'), 8456.3);
    assert.equal(stateOf(gladys, min, 'status'), 'Normal');
    assert.equal(stateOf(gladys, min, 'battery_level'), 76);
    assert.equal(stateOf(gladys, min, 'grid_export_power'), 320.5);
    assert.equal(stateOf(gladys, sph, 'battery_discharge_power'), 620);
    // Read less than 5 minutes ago: nothing asked to Growatt again.
    assert.equal(growatt.requests.length, before);
    assert.ok(gladys.fake.widgetRefreshes.includes('solar_overview'));
  } finally {
    await integration.stop();
  }
});

test('the container refreshes by itself on its timer, without any onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date(2026, 9, 15, 12, 31) });
  const { gladys, growatt, integration } = await createWorld({ timers: true });
  try {
    await addAll(gladys);
    const min = findDevice(gladys, 'MIN0A1B2C3');
    assert.equal(stateOf(gladys, min, 'pv_power'), 2512.4);
    const reads = growatt.calls('v1/device/tlx/tlx_last_data').length;

    growatt.set('v1/device/tlx/tlx_last_data', 'openapi/tlx-last-data-night.json');
    t.mock.timers.tick(PERIOD);
    await settle();

    assert.equal(growatt.calls('v1/device/tlx/tlx_last_data').length, reads + 1);
    assert.equal(stateOf(gladys, min, 'pv_power'), 0);
    assert.equal(stateOf(gladys, min, 'status'), 'Waiting');
    // The cloud's 5-minute rule was never broken: no 10012 answered.
    assert.equal(growatt.rateLimited(), 0);

    // And again one period later.
    t.mock.timers.tick(PERIOD);
    await settle();
    assert.equal(growatt.calls('v1/device/tlx/tlx_last_data').length, reads + 2);
  } finally {
    await integration.stop();
  }
});

test("the core's poll is a fallback: skipped while the timer runs, used when it stalls", async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 15, 12, 31) });
  const { gladys, growatt, integration } = await createWorld();
  try {
    await addAll(gladys);
    const min = findDevice(gladys, 'MIN0A1B2C3');
    const reads = growatt.calls('v1/device/tlx/tlx_last_data').length;
    // Gladys polls every minute: the refresh just ran, nothing is read.
    for (let minute = 1; minute <= 4; minute += 1) {
      t.mock.timers.tick(60_000);
      assert.deepEqual(await gladys.fake.poll(min), { success: true });
    }
    assert.equal(growatt.calls('v1/device/tlx/tlx_last_data').length, reads);
    // The timer is off in this world: past 90 % of a period, the poll reads.
    t.mock.timers.tick(PERIOD);
    await gladys.fake.poll(min);
    assert.equal(growatt.calls('v1/device/tlx/tlx_last_data').length, reads + 1);
  } finally {
    await integration.stop();
  }
});

test('a scan, a test and a widget within 5 minutes ask Growatt nothing more', async () => {
  const { gladys, growatt, integration } = await createWorld();
  try {
    await addAll(gladys);
    const before = growatt.requests.length;
    await gladys.fake.scanRequest();
    await gladys.fake.action('test_connection', {});
    await gladys.fake.widgetGet('solar_overview', {
      settings: { device: findDevice(gladys, 'MIN0A1B2C3').external_id },
      language: 'fr',
    });
    assert.equal(growatt.requests.length, before);
  } finally {
    await integration.stop();
  }
});

test('the "Test the connection" action reports what the account holds', async () => {
  const { gladys, integration } = await createWorld();
  try {
    const ack = await gladys.fake.action('test_connection', {});
    assert.equal(ack.success, true);
    assert.match(ack.data.message.en, /1 plant\(s\), 2 inverter\(s\) with detailed data/);
    assert.match(
      ack.data.message.fr,
      /Totaux de l'installation seulement pour : INV4D5E6F7 \(inverter\)/,
    );
    assert.deepEqual(Object.keys(ack.data.message), ['en', 'fr', 'de', 'es']);
  } finally {
    await integration.stop();
  }
});

test('the status trigger fires on a change, never on the first reading', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date(2026, 9, 15, 12, 31) });
  const { gladys, growatt, integration } = await createWorld({
    timers: true,
    config: { ...TOKEN_CONFIG, language: 'fr' },
  });
  try {
    await addAll(gladys);
    t.mock.timers.tick(PERIOD);
    await settle();
    assert.equal(gladys.fake.sceneEvents.length, 0, 'same status: no event');

    const fault = fixture('openapi/tlx-last-data.json');
    fault.data.status = 3;
    growatt.set('v1/device/tlx/tlx_last_data', fault);
    t.mock.timers.tick(PERIOD);
    await settle();

    const min = findDevice(gladys, 'MIN0A1B2C3');
    assert.deepEqual(gladys.fake.sceneEvents, [
      {
        key: 'inverter_status_changed',
        data: {
          device: min.external_id,
          status: 'fault',
          previous_status: 'normal',
          status_label: 'En défaut',
          device_name: 'Growatt MIN MIN0A1B2C3',
        },
      },
    ]);
    assert.equal(stateOf(gladys, min, 'status'), 'En défaut');
  } finally {
    await integration.stop();
  }
});

test('a battery seen for the first time is offered as new features (Discovery tab)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date(2026, 9, 15, 12, 31) });
  const { gladys, growatt, integration } = await createWorld({
    timers: true,
    routes: { 'v1/device/tlx/tlx_last_data': 'openapi/tlx-last-data-no-battery.json' },
  });
  try {
    await addAll(gladys);
    const keys = () =>
      findDevice(gladys, 'MIN0A1B2C3').features.map((f) => f.external_id.split(':').pop());
    assert.ok(!keys().includes('battery_level'));

    growatt.set('v1/device/tlx/tlx_last_data', 'openapi/tlx-last-data.json');
    t.mock.timers.tick(PERIOD);
    await settle();
    assert.ok(keys().includes('battery_level'), 'republished with the battery');

    // At night the battery reads 0 again: the features stay.
    growatt.set('v1/device/tlx/tlx_last_data', 'openapi/tlx-last-data-no-battery.json');
    t.mock.timers.tick(PERIOD);
    await settle();
    assert.ok(keys().includes('battery_level'), 'never removed');
  } finally {
    await integration.stop();
  }
});

test('a refused token: one status message, then no request until the config changes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date(2026, 9, 15, 12, 31) });
  const { gladys, growatt, integration } = await createWorld({
    timers: true,
    config: { ...TOKEN_CONFIG, api_token: 'revoked-token' },
  });
  try {
    assert.deepEqual(gladys.fake.connectionStatus, { connected: false, message: TEXT.authToken });
    const requests = growatt.requests.length;
    for (let i = 0; i < 3; i += 1) {
      t.mock.timers.tick(PERIOD);
      await settle();
    }
    assert.equal(growatt.requests.length, requests, 'no retry of a refused token');
    assert.equal(gladys.fake.connectionStatuses.length, 1, 'said once');

    await gladys.fake.configUpdated(TOKEN_CONFIG);
    assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  } finally {
    await integration.stop();
  }
});

test('ShinePhone: the session is saved, never the password nor the username', async () => {
  const store = new Store({ dir: null });
  const { growatt, integration } = await createWorld({ config: PASSWORD_CONFIG, store });
  await integration.stop();
  assert.equal(growatt.calls('newTwoLoginAPI.do').length, 1);
  assert.deepEqual(store.get('session').cookies, { JSESSIONID: 'S1' });
  assert.ok(!JSON.stringify(store.data).includes(PASSWORD_CONFIG.password));
  assert.ok(!JSON.stringify(store.data).includes(PASSWORD_CONFIG.username));
});

test('ShinePhone: a restart with the saved session does not log in again', async () => {
  const store = new Store({ dir: null });
  const { createFakeGrowatt } = await import('./helpers/fakeGrowatt.js');
  const { createFakeGladys } = await import('@gladysassistant/integration-sdk/testing');
  const { registerHandlers } = await import('../src/app.js');
  const growatt = createFakeGrowatt();
  for (let restart = 0; restart < 3; restart += 1) {
    const gladys = createFakeGladys({ config: PASSWORD_CONFIG });
    const integration = registerHandlers(gladys, { store, fetch: growatt.fetch, timers: false });
    await gladys.connect();
    assert.equal(gladys.fake.discoveredDevices.length, 4);
    await integration.stop();
  }
  assert.equal(growatt.calls('newTwoLoginAPI.do').length, 1);
});

test('ShinePhone: a locked account pauses for hours, restart included', async () => {
  const store = new Store({ dir: null });
  const locked = await createWorld({
    config: PASSWORD_CONFIG,
    store,
    routes: { 'newTwoLoginAPI.do': 'shinephone/login-locked.json' },
  });
  await locked.integration.stop();
  assert.equal(locked.gladys.fake.connectionStatus.connected, false);
  assert.match(locked.gladys.fake.connectionStatus.message.en, /locked the account/);
  assert.ok(store.get('lock').until > Date.now() + 5 * 3600_000);

  const restarted = await createWorld({ config: PASSWORD_CONFIG, store });
  await restarted.integration.stop();
  assert.equal(restarted.growatt.requests.length, 0, 'no knock on a locked account');
  assert.equal(restarted.gladys.fake.connectionStatus.connected, false);
});

test('not configured: a status message, no request', async () => {
  const { gladys, growatt, integration } = await createWorld({ config: {} });
  try {
    assert.deepEqual(gladys.fake.connectionStatus, {
      connected: false,
      message: TEXT.notConfigured,
    });
    assert.equal(growatt.requests.length, 0);
    const ack = await gladys.fake.action('test_connection', {});
    assert.deepEqual(ack.data.message, TEXT.notConfigured);
  } finally {
    await integration.stop();
  }
});

test('the plant filter keeps only the chosen plants', async () => {
  const { gladys, integration } = await createWorld({
    config: { ...TOKEN_CONFIG, plant_ids: '999' },
  });
  try {
    assert.deepEqual(gladys.fake.discoveredDevices, []);
    assert.equal(gladys.fake.connectionStatus.connected, false);
    assert.deepEqual(gladys.fake.connectionStatus.message, TEXT.noPlant);
  } finally {
    await integration.stop();
  }
});

test('the cloud down then back: one failure, one recovery', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date(2026, 9, 15, 12, 31) });
  const { gladys, growatt, integration } = await createWorld({ timers: true });
  try {
    await addAll(gladys);
    const down = () => new Response('Bad gateway', { status: 502 });
    for (const route of [
      'v1/plant/data',
      'v1/device/tlx/tlx_last_data',
      'v1/device/mix/mix_data_info',
    ]) {
      growatt.set(route, down);
    }
    t.mock.timers.tick(PERIOD);
    await settle();
    assert.deepEqual(gladys.fake.connectionStatus, { connected: false, message: TEXT.unreachable });

    growatt.set('v1/plant/data', 'openapi/plant-data.json');
    growatt.set('v1/device/tlx/tlx_last_data', 'openapi/tlx-last-data.json');
    growatt.set('v1/device/mix/mix_data_info', 'openapi/mix-data-info.json');
    t.mock.timers.tick(PERIOD);
    await settle();
    assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  } finally {
    await integration.stop();
  }
});
