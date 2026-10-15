// -----------------------------------------------------------------------------
// From the Growatt answers to the normalized reading: units, vocabularies,
// statuses, and the counter glitches filtered before publication.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS,
  num,
  parseLocalTime,
  plantFromClassic,
  plantFromOpenApi,
  readingFromInverter,
  readingFromMix,
  readingFromSph,
  readingFromTlx,
  statusOf,
  unwrapDevice,
} from '../src/growatt/model.js';
import { featureKeysFor } from '../src/devices.js';
import { createCounterGuard } from '../src/guards.js';
import { fixture } from './helpers/fakeGrowatt.js';

const data = (path) => fixture(path).data;

test('numbers come as numbers, strings, or strings with their unit', () => {
  assert.equal(num(12.5), 12.5);
  assert.equal(num('12.5'), 12.5);
  assert.equal(num('12.5kWh'), 12.5);
  assert.equal(num(' 8 kW '), 8);
  assert.equal(num('-3.2'), -3.2);
  for (const nothing of [null, undefined, '', 'null', '--', NaN, Infinity, {}, true]) {
    assert.equal(num(nothing), undefined, String(nothing));
  }
});

test('statuses: codes of the TL-X and SPH families, and the lost flag', () => {
  assert.equal(statusOf(1), STATUS.NORMAL);
  assert.equal(statusOf('0'), STATUS.WAITING);
  assert.equal(statusOf(3), STATUS.FAULT);
  assert.equal(statusOf(6), STATUS.NORMAL);
  assert.equal(statusOf(-1), STATUS.OFFLINE);
  assert.equal(statusOf(1, true), STATUS.OFFLINE);
  assert.equal(statusOf(1, 'true'), STATUS.OFFLINE);
  assert.equal(statusOf(42), STATUS.UNKNOWN);
  assert.equal(statusOf(undefined), STATUS.UNKNOWN);
});

test('a MIN with battery and meter (OpenAPI tlx_last_data)', () => {
  const reading = readingFromTlx(data('openapi/tlx-last-data.json'));
  assert.equal(reading.status, STATUS.NORMAL);
  assert.equal(reading.pv_power, 2512.4);
  assert.equal(reading.pv1_voltage, 352.6);
  assert.equal(reading.pv2_current, 3.5);
  assert.equal(reading.ac_power, 2410.8);
  // The solar production is the PV energy, not the AC energy.
  assert.equal(reading.production_today, 12.6);
  assert.equal(reading.production_total, 8455.9);
  assert.equal(reading.battery_level, 76);
  // bdc2 is null on a single-battery system: the sum ignores it.
  assert.equal(reading.battery_charge_power, 850);
  assert.equal(reading.battery_discharge_total, 1450.2);
  assert.equal(reading.grid_export_power, 320.5);
  assert.equal(reading.grid_import_total, 2310.4);
  assert.equal(reading.load_total, 7210.5);
  assert.equal(reading.temperature, 41.2);
  assert.equal(reading.time, '2026-10-15 12:30:00');
});

test('a MIN without PV energy counts its AC energy', () => {
  const reading = readingFromTlx({ eacToday: '3.1', eacTotal: '1200.5', ppv: 10 });
  assert.equal(reading.production_today, 3.1);
  assert.equal(reading.production_total, 1200.5);
});

test('a device wrapped in a list is unwrapped', () => {
  const inner = { ppv: 5 };
  assert.equal(unwrapDevice({ min: [inner] }), inner);
  assert.equal(unwrapDevice({ tlx: inner }), inner);
  assert.equal(readingFromTlx({ min: [{ ppv: 7, status: 1 }] }).pv_power, 7);
});

test('an SPH: detail and last data merged (OpenAPI)', () => {
  const reading = readingFromSph({
    ...data('openapi/mix-data-info.json'),
    ...data('openapi/mix-last-data.json'),
  });
  assert.equal(reading.status, STATUS.NORMAL);
  assert.equal(reading.battery_level, 64);
  assert.equal(reading.pv_power, 2875.5);
  assert.equal(reading.production_today, 14.2);
  assert.equal(reading.production_total, 10422.8);
  assert.equal(reading.battery_discharge_power, 620);
  assert.equal(reading.battery_charge_total, 2210.4);
  assert.equal(reading.grid_import_power, 180);
  assert.equal(reading.grid_import_total, 3402.1);
  assert.equal(reading.grid_export_total, 4110.6);
  assert.equal(reading.load_total, 9123.4);
});

test('an SPH through ShinePhone: kilowatts become watts', () => {
  const reading = readingFromMix(
    fixture('shinephone/mix-status.json').obj,
    fixture('shinephone/mix-totals.json').obj,
  );
  assert.equal(reading.pv_power, 2870);
  assert.equal(reading.battery_discharge_power, 620);
  assert.equal(reading.grid_import_power, 180);
  assert.equal(reading.load_power, 2310);
  assert.equal(reading.battery_level, 64);
  assert.equal(reading.production_total, 10422.8);
  assert.equal(reading.status, STATUS.NORMAL);
});

test('a string inverter through ShinePhone', () => {
  const reading = readingFromInverter(fixture('shinephone/inverter-detail.json'));
  assert.equal(reading.pv_power, 845.3);
  assert.equal(reading.ac_power, 812);
  assert.equal(reading.production_today, 4.4);
  assert.equal(reading.production_total, 21345.6);
  assert.equal(reading.temperature, 38.1);
  assert.equal(reading.battery_level, undefined);
});

test('plant totals: kW of plant/data, refined by the newest recent point of plant/power', () => {
  const now = new Date(2026, 9, 15, 12, 31);
  const plant = plantFromOpenApi(
    data('openapi/plant-data.json'),
    data('openapi/plant-power.json'),
    now,
  );
  // 12:30 has no power: the 12:25 point wins over current_power (2.456 kW).
  assert.deepEqual(plant, { power: 2468.2, production_today: 12.5, production_total: 8456.3 });
  // An old curve does not count.
  const later = plantFromOpenApi(
    data('openapi/plant-data.json'),
    data('openapi/plant-power.json'),
    new Date(2026, 9, 15, 13, 0),
  );
  assert.equal(later.power, 2456);
  assert.deepEqual(plantFromClassic(fixture('shinephone/plant-info.json')), {
    power: 2456,
    production_today: 12.5,
    production_total: 8456.3,
  });
});

test('local times', () => {
  assert.equal(parseLocalTime('2026-10-15 12:30').getHours(), 12);
  assert.equal(parseLocalTime('2026-10-15 07:05:09').getSeconds(), 9);
  assert.equal(parseLocalTime('yesterday'), undefined);
  assert.equal(parseLocalTime(null), undefined);
});

test('features: a battery only with a sign of life, a meter only when it counted', () => {
  const full = featureKeysFor('min', readingFromTlx(data('openapi/tlx-last-data.json')));
  for (const key of ['battery_level', 'grid_import_total', 'load_total', 'pv2_voltage']) {
    assert.ok(full.includes(key), key);
  }
  // Unused MPPT inputs 3 and 4 read 0: no feature.
  assert.ok(!full.includes('pv3_voltage'));

  const bare = featureKeysFor('min', readingFromTlx(data('openapi/tlx-last-data-no-battery.json')));
  assert.ok(!bare.some((key) => /^(battery|grid|load)_/.test(key)), bare.join());
  assert.ok(bare.includes('production_total') && bare.includes('status'));

  // An SPH always has its battery, even read empty.
  assert.ok(featureKeysFor('sph', { battery_level: 0 }).includes('battery_level'));
});

test('counter guard: an index never falls back to 0, and small drops are noise', () => {
  const guard = createCounterGuard();
  assert.equal(guard.filter('a', 'total', 100), 100);
  assert.equal(guard.filter('a', 'total', 0), 100);
  assert.equal(guard.filter('a', 'total', 99.8), 100);
  assert.equal(guard.filter('a', 'total', 100.4), 100.4);
  // A new inverter (a big drop to a value above 0) goes through.
  assert.equal(guard.filter('a', 'total', 12), 12);
});

test('counter guard: the midnight bounce of a daily counter is suppressed', () => {
  const guard = createCounterGuard();
  assert.equal(guard.filter('d', 'today', 12.5), 12.5);
  assert.equal(guard.filter('d', 'today', 0), 0);
  // Yesterday's final value served once more: still 0.
  assert.equal(guard.filter('d', 'today', 12.5), 0);
  assert.equal(guard.filter('d', 'today', 0.1), 0.1);
  assert.equal(guard.filter('d', 'today', 0.4), 0.4);
});
