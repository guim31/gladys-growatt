// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures: OpenAPI (MIN with battery and meter, MIN without battery, SPH,
// a MIN read at night) and ShinePhone (TL-X, SPH, string inverter), in every
// feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PASSWORD_CONFIG, TOKEN_CONFIG, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const scenarios = [
  { label: 'OpenAPI token, English', config: TOKEN_CONFIG, devices: 3 },
  { label: 'OpenAPI token, French', config: { ...TOKEN_CONFIG, language: 'fr' }, devices: 3 },
  { label: 'OpenAPI token, German', config: { ...TOKEN_CONFIG, language: 'de' }, devices: 3 },
  { label: 'OpenAPI token, Spanish', config: { ...TOKEN_CONFIG, language: 'es' }, devices: 3 },
  {
    label: 'MIN without battery',
    config: TOKEN_CONFIG,
    routes: { 'v1/device/tlx/tlx_last_data': 'openapi/tlx-last-data-no-battery.json' },
    devices: 3,
  },
  {
    label: 'MIN read at night',
    config: TOKEN_CONFIG,
    routes: { 'v1/device/tlx/tlx_last_data': 'openapi/tlx-last-data-night.json' },
    devices: 3,
  },
  { label: 'ShinePhone account, English', config: PASSWORD_CONFIG, devices: 4 },
  {
    label: 'ShinePhone account, French',
    config: { ...PASSWORD_CONFIG, language: 'fr' },
    devices: 4,
  },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const { gladys, integration } = await createWorld({
      config: scenario.config,
      routes: scenario.routes,
    });
    try {
      const devices = gladys.fake.discoveredDevices;
      assert.equal(devices.length, scenario.devices, 'the plant and its detailed inverters');

      const deviceIds = new Set();
      for (const device of devices) {
        const where = device.name;
        assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
        deviceIds.add(device.external_id);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (allowed) {
              assert.ok(
                allowed.includes(feature.unit),
                `${at}: unit ${feature.unit} not allowed for ${feature.category}`,
              );
            }
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
          assert.ok(feature.name.length <= 40, `${at}: feature name too long`);
        }
      }
    } finally {
      await integration.stop();
    }
  });
}

test('the energy indexes are kWh counters of the categories the energy monitoring reads', async () => {
  const { gladys, integration } = await createWorld();
  try {
    const features = gladys.fake.discoveredDevices.flatMap((device) => device.features);
    const indexes = features.filter((feature) => /index$/.test(feature.type));
    assert.ok(indexes.length >= 7, 'production, battery, grid and home indexes');
    for (const feature of indexes) {
      assert.equal(feature.unit, 'kilowatt-hour', `${feature.name}: an index is in kWh`);
    }
  } finally {
    await integration.stop();
  }
});
