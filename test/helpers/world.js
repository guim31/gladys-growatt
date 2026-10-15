// -----------------------------------------------------------------------------
// The integration running on the SDK's fake Gladys
// (`@gladysassistant/integration-sdk/testing`) against the fake Growatt cloud.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { PASSWORD, TOKEN, USERNAME, createFakeGrowatt } from './fakeGrowatt.js';

export const TOKEN_CONFIG = { auth_mode: 'token', api_token: TOKEN, language: 'en' };
export const PASSWORD_CONFIG = {
  auth_mode: 'password',
  username: USERNAME,
  password: PASSWORD,
  language: 'en',
};

/**
 * @param {object} [options]
 * @param {object} [options.config] the integration config (token mode by default)
 * @param {object} [options.routes] fake Growatt route overrides
 * @param {Store} [options.store]
 * @param {boolean} [options.timers] run the container's timer (off by default)
 * @param {boolean} [options.connect] connect at once (default true)
 */
export async function createWorld({
  config = TOKEN_CONFIG,
  routes,
  store = new Store({ dir: null }),
  timers = false,
  connect = true,
} = {}) {
  const growatt = createFakeGrowatt({ routes });
  const gladys = createFakeGladys({ config });
  const integration = registerHandlers(gladys, { store, fetch: growatt.fetch, timers });
  if (connect) {
    await gladys.connect();
  }
  return { gladys, growatt, store, integration, app: integration.app };
}

/** The user adds every discovered device to Gladys ("Add" in the Discovery tab). */
export async function addAll(gladys) {
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(structuredClone(device));
  }
}

/** The last published state of a feature of a device, by feature key. */
export function stateOf(gladys, device, key) {
  return gladys.fake.lastState(`${device.external_id}:${key}`);
}

export function findDevice(gladys, fragment) {
  return gladys.fake.discoveredDevices.find((device) => device.external_id.includes(fragment));
}
