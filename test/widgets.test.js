// -----------------------------------------------------------------------------
// The "Solar overview" widget: valid for the core (the SDK's
// validateWidgetContent: vocabulary and content budget), every bound feature
// exists on the device, and in every language.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { TEXT } from '../src/i18n.js';
import { PASSWORD_CONFIG, TOKEN_CONFIG, addAll, createWorld } from './helpers/world.js';

const LANGS = ['en', 'fr', 'de', 'es'];

function boundFeatures(content) {
  return content.components.flatMap((component) => [
    ...(component.device_feature ? [component.device_feature] : []),
    ...(component.device_features ?? []),
  ]);
}

for (const [label, config] of [
  ['OpenAPI', TOKEN_CONFIG],
  ['ShinePhone', PASSWORD_CONFIG],
]) {
  test(`the widget of every device is valid and bound to real features (${label})`, async () => {
    const { gladys, integration } = await createWorld({ config });
    try {
      await addAll(gladys);
      for (const device of gladys.fake.discoveredDevices) {
        const featureIds = new Set(device.features.map((feature) => feature.external_id));
        for (const language of LANGS) {
          const ack = await gladys.fake.widgetGet('solar_overview', {
            settings: { device: device.external_id },
            language,
          });
          assert.equal(ack.success, true);
          const { content } = ack.data;
          assert.deepEqual(validateWidgetContent(content), [], `${device.name} (${language})`);
          assert.ok(content.components.length <= 8);
          const bound = boundFeatures(content);
          assert.ok(bound.length >= 2, `${device.name}: tiles and chart`);
          for (const id of bound) {
            assert.ok(featureIds.has(id), `${device.name}: ${id} is not a feature of the device`);
          }
        }
      }
    } finally {
      await integration.stop();
    }
  });
}

test('the widget of an inverter with a battery: six tiles, the curve, the status', async () => {
  const { gladys, integration } = await createWorld();
  try {
    await addAll(gladys);
    const min = gladys.fake.discoveredDevices.find((d) => d.external_id.includes('MIN0A1B2C3'));
    const {
      data: { content: data },
    } = await gladys.fake.widgetGet('solar_overview', {
      settings: { device: min.external_id },
      language: 'fr',
    });
    const types = data.components.map((component) => component.type);
    assert.deepEqual(types, [
      'value',
      'value',
      'value',
      'value',
      'value',
      'value',
      'chart',
      'status',
    ]);
    assert.deepEqual(
      data.components.slice(0, 6).map((component) => component.label),
      ['Production', "Aujourd'hui", 'Batterie', 'Import réseau', 'Export réseau', 'Maison'],
    );
    assert.deepEqual(data.components[7].items[0], {
      label: 'État',
      value: 'Normal',
      color: 'success',
    });
  } finally {
    await integration.stop();
  }
});

test('the widget without a device, or with a device gone', async () => {
  const { gladys, integration } = await createWorld();
  try {
    const none = await gladys.fake.widgetGet('solar_overview', { settings: {}, language: 'de' });
    assert.equal(none.data.content.components[0].text, TEXT.widgetPickDevice.de);
    const gone = await gladys.fake.widgetGet('solar_overview', {
      settings: { device: 'ext:test-integration:inverter:GONE' },
      language: 'es',
    });
    assert.equal(gone.data.content.components[0].text, TEXT.widgetUnknownDevice.es);
    assert.deepEqual(validateWidgetContent(gone.data.content), []);
  } finally {
    await integration.stop();
  }
});
