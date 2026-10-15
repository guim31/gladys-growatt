// -----------------------------------------------------------------------------
// Growatt OpenAPI V1: the token API Growatt gives to its installers and, on
// request, to plant owners. Stateless: the token travels in a `token` header
// on every request, nothing to log in, nothing to store.
//
// Every answer is `{ error_code, error_msg, data }`; a non-zero code is an
// error. Known generic codes (growattServer `GrowattV1ApiErrorCode`):
// 10011 no privilege (bad token), 10012 the endpoint was called less than
// 5 minutes ago, -1 "use the new domain name" (wrong region).
//
// Detailed data exists for two families only: MIN (type 7: MIN, TL-X,
// TL-XH, MOD, MIC) and SPH (type 5). The other devices of a plant are
// counted in the plant totals.
// -----------------------------------------------------------------------------

import { ERROR_CODES, GrowattError } from './errors.js';
import { endpointOf, exchange, form } from './http.js';
import {
  num,
  plantFromOpenApi,
  readingFromSph,
  readingFromTlx,
  statusOf,
  unwrapDevice,
} from './model.js';

const NO_PRIVILEGE = 10011;
const RATE_LIMITED = 10012;
const WRONG_DOMAIN = -1;

/** OpenAPI device types (growattServer `DeviceType`). */
export const OPENAPI_TYPES = {
  1: 'inverter',
  2: 'storage',
  3: 'other',
  4: 'max',
  5: 'sph',
  6: 'spa',
  7: 'min',
  8: 'pcs',
  9: 'hps',
  10: 'pbd',
};

/** The families this client reads in detail. */
const DETAILED = new Set(['min', 'sph']);

export class OpenApiClient {
  /**
   * @param {object} options
   * @param {string} options.server base URL with its trailing slash
   * @param {string} options.token
   * @param {typeof fetch} [options.fetch]
   */
  constructor({ server, token, fetch: fetchImpl = globalThis.fetch }) {
    this.base = `${server}v1/`;
    this.token = token;
    this.fetch = fetchImpl;
    this.mode = 'token';
  }

  async call(method, path, fields = {}) {
    const url = new URL(path, this.base);
    const init = { method, headers: { token: this.token, Accept: 'application/json' } };
    if (method === 'GET') {
      for (const [key, value] of Object.entries(fields)) {
        url.searchParams.set(key, String(value));
      }
    } else {
      init.body = form(fields);
    }
    const { status, json } = await exchange(this.fetch, url.toString(), init);
    const where = endpointOf(url.toString());
    if (status === 401 || status === 403) {
      throw new GrowattError(ERROR_CODES.AUTH, `${where}: HTTP ${status}`);
    }
    if (status >= 400) {
      throw new GrowattError(ERROR_CODES.NETWORK, `${where}: HTTP ${status}`);
    }
    if (!json || typeof json !== 'object') {
      throw new GrowattError(ERROR_CODES.PROTOCOL, `${where}: not a JSON answer`);
    }
    const code = num(json.error_code);
    if (code === 0) {
      return json.data ?? {};
    }
    const message = String(json.error_msg ?? '').slice(0, 120);
    if (code === NO_PRIVILEGE) {
      throw new GrowattError(ERROR_CODES.AUTH, `${where}: token refused (${code})`, {
        apiCode: code,
      });
    }
    if (code === RATE_LIMITED) {
      throw new GrowattError(ERROR_CODES.RATE_LIMITED, `${where}: called too often (${code})`, {
        apiCode: code,
      });
    }
    if (code === WRONG_DOMAIN) {
      throw new GrowattError(ERROR_CODES.AUTH, `${where}: wrong server region (${code})`, {
        apiCode: code,
      });
    }
    throw new GrowattError(ERROR_CODES.PROTOCOL, `${where}: error ${json.error_code} ${message}`, {
      apiCode: json.error_code,
    });
  }

  /** @returns {Promise<{ id: string, name: string }[]>} */
  async listPlants() {
    const data = await this.call('GET', 'plant/list', { page: 1, perpage: 100 });
    return (data.plants ?? [])
      .filter((plant) => plant && plant.plant_id !== undefined)
      .map((plant) => ({ id: String(plant.plant_id), name: String(plant.name ?? plant.plant_id) }));
  }

  /** The devices of a plant, as DeviceSummary objects (see src/account.js). */
  async listDevices(plantId) {
    const data = await this.call('GET', 'device/list', {
      plant_id: plantId,
      page: 1,
      perpage: 100,
    });
    return (data.devices ?? [])
      .filter((device) => device && device.device_sn)
      .map((device) => {
        const family = OPENAPI_TYPES[num(device.type)] ?? 'other';
        return {
          sn: String(device.device_sn),
          plantId: String(plantId),
          family,
          detailed: DETAILED.has(family),
          name: undefined,
          model: typeof device.model === 'string' ? device.model : undefined,
          status: statusOf(device.status, device.lost),
          lost: device.lost === true,
          lastUpdate:
            typeof device.last_update_time === 'string' ? device.last_update_time : undefined,
        };
      });
  }

  /** Plant totals: power (W), production today and total (kWh). */
  async readPlant(plantId, now = new Date()) {
    const data = await this.call('GET', 'plant/data', { plant_id: plantId });
    let powers = null;
    try {
      powers = await this.call('GET', 'plant/power', { plant_id: plantId, date: localDate(now) });
    } catch (err) {
      // The power curve only refines the current power: plant/data has one.
      if (err.code === ERROR_CODES.AUTH) {
        throw err;
      }
    }
    return plantFromOpenApi(data, powers, now);
  }

  /** The reading of one detailed device (MIN or SPH). */
  async readDevice(device) {
    if (device.family === 'min') {
      const last = await this.call('POST', 'device/tlx/tlx_last_data', { tlx_sn: device.sn });
      return readingFromTlx(last);
    }
    if (device.family === 'sph') {
      // The battery level, the PV voltages and the grid powers are in the
      // detail, the powers and energies in the last data (Home Assistant
      // reads both too). The last data wins where both answer.
      const detail = await this.call('GET', 'device/mix/mix_data_info', { device_sn: device.sn });
      const last = await this.call('POST', 'device/mix/mix_last_data', { mix_sn: device.sn });
      return readingFromSph({ ...unwrapDevice(detail), ...unwrapDevice(last) });
    }
    throw new GrowattError(ERROR_CODES.PROTOCOL, `no detailed data for a ${device.family} device`);
  }
}

/** YYYY-MM-DD in the local time of the container (TZ is Gladys' time zone). */
export function localDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
