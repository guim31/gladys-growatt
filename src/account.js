// -----------------------------------------------------------------------------
// The Growatt account of the configuration: which client talks to Growatt,
// what the account holds (plants, devices), and the rules that keep the
// account out of trouble with the Growatt limits:
//
//   - one read of a given endpoint per MIN_GAP_MS at most: a reading younger
//     than that is served from memory (a "Test" click, a widget, a scan and
//     the timer never multiply the requests); two callers asking for the same
//     reading at once share one request;
//   - the device lists are read again once an hour (OpenAPI), or come with
//     the plant page every refresh (ShinePhone, same request as the totals);
//   - a refused token or password stops every request until the
//     configuration changes: retrying a wrong password is how an account
//     gets locked;
//   - a ShinePhone "507" (account locked), or a login the server refuses with
//     HTTP 403 (bot protection), pauses the account for LOCK_PAUSE_MS, saved in
//     /data so that a restart does not knock again.
// -----------------------------------------------------------------------------

import { accountKey, ClassicClient } from './growatt/classic.js';
import { ERROR_CODES, GrowattError } from './growatt/errors.js';
import { STATUS } from './growatt/model.js';
import { OpenApiClient } from './growatt/openapi.js';
import { secretsOf, serverUrl } from './config.js';

/** Growatt refuses an endpoint called twice within 5 minutes. */
export const MIN_GAP_MS = 5 * 60_000;
/** The OpenAPI device lists are read again after this. */
export const DEVICE_LIST_MAX_AGE_MS = 60 * 60_000;
/** Pause after a Growatt "507" (the lockout is reported to last about 24 h). */
export const LOCK_PAUSE_MS = 6 * 60 * 60_000;

export class Account {
  /**
   * @param {object} options
   * @param {object} options.config normalized config
   * @param {import('./store.js').Store} options.store
   * @param {typeof fetch} [options.fetch]
   * @param {() => number} [options.now]
   */
  constructor({ config, store, fetch: fetchImpl = globalThis.fetch, now = () => Date.now() }) {
    this.config = config;
    this.store = store;
    this.now = now;
    this.secrets = secretsOf(config);
    const server = serverUrl(config);
    this.key =
      config.auth_mode === 'token'
        ? `token:${accountKey(server, config.api_token)}`
        : `password:${accountKey(server, config.username)}`;
    if (config.auth_mode === 'token') {
      this.client = new OpenApiClient({ server, token: config.api_token, fetch: fetchImpl });
    } else {
      const saved = store.get('session');
      this.client = new ClassicClient({
        server,
        username: config.username,
        password: config.password,
        session: saved?.key === this.key ? saved : null,
        onSession: (session) =>
          store.set('session', session ? { key: this.key, ...session } : null),
        fetch: fetchImpl,
        now,
      });
    }
    /** @type {{ id: string, name: string }[] | null} */
    this.plants = null;
    /** Devices by serial number (summaries of the Growatt device lists). */
    this.devices = new Map();
    this.deviceListAt = new Map();
    this.cache = new Map();
    this.inFlight = new Map();
    /** A refused token or password: no request until the config changes. */
    this.authError = null;
  }

  /** Until when the account is paused after a "507" or a refused login (403), or null. */
  lockedUntil() {
    const lock = this.store.get('lock');
    if (!lock || lock.key !== this.key || lock.until <= this.now()) {
      return null;
    }
    return lock.until;
  }

  /** Throws without calling Growatt when the account must not be called. */
  guard() {
    if (this.authError) {
      throw this.authError;
    }
    const until = this.lockedUntil();
    if (until !== null) {
      const blocked = this.store.get('lock')?.reason === ERROR_CODES.BLOCKED;
      throw new GrowattError(
        blocked ? ERROR_CODES.BLOCKED : ERROR_CODES.LOCKED,
        blocked
          ? 'account paused: the Growatt server refused the login'
          : 'account paused after a Growatt lockout',
      );
    }
  }

  /** Runs a Growatt call, recording the auth refusals and the lockouts. */
  async run(fn) {
    this.guard();
    try {
      return await fn();
    } catch (err) {
      const safe = this.scrub(err);
      if (safe.code === ERROR_CODES.AUTH) {
        this.authError = safe;
      }
      if (safe.code === ERROR_CODES.LOCKED || safe.code === ERROR_CODES.BLOCKED) {
        this.store.set('lock', {
          key: this.key,
          until: this.now() + LOCK_PAUSE_MS,
          reason: safe.code,
        });
      }
      throw safe;
    }
  }

  /**
   * An error safe to log and to show: a GrowattError carries no secret by
   * construction; anything else is wrapped, its message scrubbed.
   */
  scrub(err) {
    const wrapped =
      err instanceof GrowattError
        ? err
        : new GrowattError(ERROR_CODES.PROTOCOL, String(err?.message ?? err));
    let message = wrapped.message;
    for (const secret of this.secrets) {
      message = message.split(secret).join('***');
    }
    if (message !== wrapped.message) {
      return new GrowattError(wrapped.code, message, { apiCode: wrapped.apiCode });
    }
    return wrapped;
  }

  /**
   * A value read at most once per MIN_GAP_MS, shared by concurrent callers.
   * @param {string} key
   * @param {() => Promise<unknown>} read
   */
  async cached(key, read, { maxAge = MIN_GAP_MS } = {}) {
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < maxAge) {
      return hit.value;
    }
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key);
    }
    const promise = this.run(read).then((value) => {
      this.cache.set(key, { at: this.now(), value });
      return value;
    });
    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  /** The plants of the account, filtered by the configured plant ids. */
  async listPlants() {
    const plants = await this.cached('plants', () => this.client.listPlants(), {
      maxAge: DEVICE_LIST_MAX_AGE_MS,
    });
    const wanted = this.config.plant_ids;
    this.plants = wanted.length > 0 ? plants.filter((plant) => wanted.includes(plant.id)) : plants;
    return this.plants;
  }

  /** The devices of a plant (OpenAPI: read hourly; ShinePhone: with the plant page). */
  async listDevices(plantId) {
    if (this.config.auth_mode === 'password') {
      // The ShinePhone plant page carries the list: one request for both.
      await this.readPlant(plantId);
      return this.cache.get(`devices:${plantId}`)?.value ?? [];
    }
    const devices = await this.cached(
      `devices:${plantId}`,
      () => this.client.listDevices(plantId),
      { maxAge: DEVICE_LIST_MAX_AGE_MS },
    );
    this.absorbDevices(plantId, devices);
    return devices;
  }

  absorbDevices(plantId, devices) {
    for (const device of devices) {
      this.devices.set(device.sn, device);
    }
    this.deviceListAt.set(plantId, this.now());
  }

  /** Plant totals: { power, production_today, production_total }. */
  async readPlant(plantId) {
    const reading = await this.cached(`plant:${plantId}`, () => this.client.readPlant(plantId));
    if (Array.isArray(reading.devices)) {
      // The ShinePhone plant page carries the device list: fresher statuses for free.
      this.absorbDevices(plantId, reading.devices);
      this.cache.set(`devices:${plantId}`, { at: this.now(), value: reading.devices });
    }
    const { devices: _devices, ...totals } = reading;
    return totals;
  }

  /** The reading of one inverter, with the status the device list adds. */
  async readDevice(sn) {
    const summary = this.devices.get(sn);
    if (!summary) {
      throw new GrowattError(ERROR_CODES.PROTOCOL, `inverter ${sn} not in the account`);
    }
    const reading = await this.cached(`device:${sn}`, () => this.client.readDevice(summary));
    const status =
      summary.lost || summary.status === STATUS.OFFLINE
        ? STATUS.OFFLINE
        : reading.status && reading.status !== STATUS.UNKNOWN
          ? reading.status
          : summary.status;
    return { ...reading, status };
  }

  /**
   * Everything the account holds: plants, their devices, and the readings
   * the discovery needs. A device that cannot be read is skipped (logged by
   * the caller), never the whole account.
   * @returns {Promise<{ plants: object[], devices: object[], failures: { what: string, error: GrowattError }[] }>}
   */
  async discover() {
    const plants = await this.listPlants();
    const result = { plants: [], devices: [], failures: [] };
    for (const plant of plants) {
      let totals = {};
      try {
        totals = await this.readPlant(plant.id);
      } catch (err) {
        if (isFatal(err)) {
          throw err;
        }
        result.failures.push({ what: `plant ${plant.id}`, error: err });
      }
      result.plants.push({ ...plant, reading: totals });
      let devices = [];
      try {
        devices = await this.listDevices(plant.id);
      } catch (err) {
        if (isFatal(err)) {
          throw err;
        }
        result.failures.push({ what: `devices of plant ${plant.id}`, error: err });
      }
      for (const summary of devices) {
        if (!summary.detailed) {
          result.devices.push({ summary, reading: null });
          continue;
        }
        try {
          result.devices.push({ summary, reading: await this.readDevice(summary.sn) });
        } catch (err) {
          if (isFatal(err)) {
            throw err;
          }
          result.failures.push({ what: `inverter ${summary.sn}`, error: err });
          result.devices.push({ summary, reading: null });
        }
      }
    }
    return result;
  }
}

/** Errors after which no other request of the account may go out. */
export function isFatal(err) {
  return [ERROR_CODES.AUTH, ERROR_CODES.LOCKED, ERROR_CODES.BLOCKED].includes(err?.code);
}
