// -----------------------------------------------------------------------------
// The integration: registers every SDK handler on a GladysIntegration (or the
// SDK's fake Gladys in the tests) and drives the Growatt account.
//
//   start      config → account → discovery (plants, inverters) → devices
//              published → refresh now, then on the container's timer;
//   refresh    reads the plants and inverters ADDED to Gladys only, publishes
//              what changed (SDK deduplication, 6 h heartbeat), fires the
//              status trigger, and offers new features (a battery seen for
//              the first time) through the Discovery tab;
//   handlers   scan, device created (states sent again at once), the
//              "Test the connection" action, the widget, the core's poll.
//
// The logs stay quiet: nothing at info level for a normal refresh. Info is
// the life cycle (start, account connected, an inverter lost and back, an
// action of the user); a failure that lasts is one warning, and one info
// line when it ends (src/issues.js).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { Account, isFatal } from './account.js';
import { isConfigured, normalizeConfig, refreshPeriodMs } from './config.js';
import {
  INVERTER,
  PLANT,
  buildInverterDevice,
  buildPlantDevice,
  featureKeysFor,
  featureSpec,
  inverterName,
  plantKeysFor,
  statesFor,
} from './devices.js';
import { ERROR_CODES } from './growatt/errors.js';
import { STATUS } from './growatt/model.js';
import { createCounterGuard } from './guards.js';
import { MESSAGES, STATUS_LABELS, TEXT, inLanguage } from './i18n.js';
import { createIssueLog } from './issues.js';
import { createPoller } from './poller.js';
import { Store } from './store.js';
import { WIDGET_KEY, buildOverview, messageContent } from './widgets.js';

const logger = createLogger({ name: 'growatt' });

export const ACTION_TEST = 'test_connection';
export const TRIGGER_STATUS = 'inverter_status_changed';
export const SCENE_TRIGGER_KEYS = [TRIGGER_STATUS];

/** A value that does not change is published again after this (Gladys flags data older than 48 h). */
export const HEARTBEAT_MS = 6 * 60 * 60_000;

export class GrowattApp {
  /**
   * @param {object} options
   * @param {object} options.gladys
   * @param {Store} options.store
   * @param {typeof fetch} [options.fetch]
   * @param {boolean} [options.timers]
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, fetch: fetchImpl, timers = true, now = () => Date.now() }) {
    this.gladys = gladys;
    this.store = store;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.now = now;
    this.config = normalizeConfig();
    this.account = null;
    this.guard = createCounterGuard();
    this.issues = createIssueLog(logger);
    /** Discovered devices by external id: { kind, id, keys, plant | summary }. */
    this.structure = new Map();
    /** The last reading of each device, by external id (re-publication, widget). */
    this.readings = new Map();
    /** The last status of each inverter, by external id (status trigger). */
    this.statuses = new Map();
    /** Which inverters Growatt marks as lost, by serial (life cycle logs). */
    this.lost = new Map();
    /** Devices announced by onDeviceCreated, in case gladys.devices lags behind. */
    this.createdHints = new Map();
    /** The connection status last sent to Gladys, to send changes only. */
    this.connectionKey = null;
    this.storeLoaded = null;
    this.poller = createPoller({
      refresh: (options) => this.refresh(options),
      periodMs: () => refreshPeriodMs(this.config),
      timers,
      now,
    });
  }

  // --- Life cycle -------------------------------------------------------------

  async start(rawConfig) {
    this.storeLoaded ??= this.store.load();
    await this.storeLoaded;
    this.poller.stop();
    await this.poller.idle();
    const config = normalizeConfig(rawConfig);
    // A reconnection to Gladys with the same configuration keeps the account,
    // its readings of the last 5 minutes and its refusals: no extra request.
    const sameAccount =
      this.account !== null && JSON.stringify(config) === JSON.stringify(this.config);
    this.config = config;
    this.connectionKey = null;
    if (!sameAccount) {
      this.structure.clear();
      this.readings.clear();
      this.statuses.clear();
      this.account = null;
    }
    if (!isConfigured(this.config)) {
      logger.info('Not configured yet: waiting for a Growatt token or account');
      await this.setConnection(false, 'notConfigured', TEXT.notConfigured);
      return;
    }
    if (!sameAccount) {
      this.account = new Account({
        config: this.config,
        store: this.store,
        fetch: this.fetch,
        now: this.now,
      });
      logger.info(`Connecting to Growatt (${this.config.auth_mode} mode, ${this.config.server})`);
    }
    // Published again on every start: Gladys may have restarted. When the
    // account cannot be read, the timer retries (a refused account stays
    // refused, without a single request, until the configuration changes).
    await this.discoverAndPublish({ announce: !sameAccount });
    await this.poller.restart();
  }

  async stop() {
    this.poller.stop();
    await this.poller.idle();
    await this.store.flush();
  }

  // --- Discovery -------------------------------------------------------------

  /**
   * Reads the account (cached readings within 5 minutes) and publishes the
   * devices. Returns false when the account could not be read.
   */
  async discoverAndPublish({ announce = false } = {}) {
    if (!this.account) {
      return false;
    }
    let result;
    try {
      result = await this.account.discover();
    } catch (err) {
      await this.reportFailure(err);
      return false;
    }
    for (const { what, error } of result.failures) {
      this.issues.fail(`read:${what}`, `Reading ${what} failed (${error.message})`);
    }
    this.applyDiscovery(result);
    try {
      await this.gladys.publishDiscoveredDevices(this.discoveredDevices());
    } catch (err) {
      logger.error(`Publishing the devices failed (${err.message})`);
      return false;
    }
    if (result.plants.length === 0) {
      logger.warn('The Growatt account has no plant');
      await this.setConnection(false, 'noPlant', TEXT.noPlant);
      return true;
    }
    if (announce) {
      const inverters = result.devices.filter((entry) => entry.summary.detailed).length;
      logger.info(
        `Growatt account connected: ${result.plants.length} plant(s), ${inverters} inverter(s) with detailed data`,
      );
    }
    this.issues.ok('cloud', 'The Growatt cloud answers again');
    this.issues.ok('account', 'The Growatt account is usable again');
    await this.setConnection(true, 'ok');
    return true;
  }

  applyDiscovery({ plants, devices }) {
    for (const plant of plants) {
      const ids = this.gladys.externalIds(PLANT, plant.id);
      const keys = this.store.rememberFeatures(ids.device, [
        ...plantKeysFor(plant.reading ?? {}),
        ...this.createdKeys(ids.device),
      ]);
      this.structure.set(ids.device, { kind: PLANT, id: plant.id, plant, keys });
    }
    for (const { summary, reading } of devices) {
      if (!summary.detailed) {
        continue;
      }
      const ids = this.gladys.externalIds(INVERTER, summary.sn);
      const keys = this.store.rememberFeatures(ids.device, [
        ...(reading ? featureKeysFor(summary.family, reading) : []),
        ...this.createdKeys(ids.device),
      ]);
      if (keys.size === 0) {
        // Never read, never created: nothing to offer yet.
        continue;
      }
      this.structure.set(ids.device, { kind: INVERTER, id: summary.sn, summary, keys });
    }
  }

  discoveredDevices() {
    return [...this.structure.values()].map((entry) =>
      entry.kind === PLANT
        ? buildPlantDevice(this.gladys, entry.plant, entry.keys, this.config.language)
        : buildInverterDevice(this.gladys, entry.summary, entry.keys, this.config.language),
    );
  }

  /** The feature keys of a device added to Gladys (empty when it is not added). */
  createdKeys(deviceExternalId) {
    const device = this.findCreated(deviceExternalId);
    const prefix = `${deviceExternalId}:`;
    return (device?.features ?? [])
      .map((feature) => String(feature.external_id ?? ''))
      .filter((id) => id.startsWith(prefix))
      .map((id) => id.slice(prefix.length))
      .filter((key) => featureSpec(key));
  }

  isCreated(deviceExternalId) {
    return this.findCreated(deviceExternalId) !== undefined;
  }

  findCreated(deviceExternalId) {
    return (
      (this.gladys.devices ?? []).find((d) => d.external_id === deviceExternalId) ??
      this.createdHints.get(deviceExternalId)
    );
  }

  // --- Refresh ---------------------------------------------------------------

  /**
   * Reads the devices added to Gladys and publishes their states.
   * @param {{ only?: string[] }} [options] external ids to refresh (default: all added)
   */
  async refresh({ only } = {}) {
    if (!this.account) {
      return;
    }
    if (this.gladys.connected === false) {
      logger.debug('Gladys unreachable: refresh skipped');
      return;
    }
    if (this.structure.size === 0 && !(await this.discoverAndPublish())) {
      return;
    }
    const targets = [...this.structure.entries()].filter(
      ([externalId]) => this.isCreated(externalId) && (!only || only.includes(externalId)),
    );
    if (targets.length === 0) {
      logger.debug('No Growatt device added to Gladys: nothing to read');
      return;
    }

    const states = [];
    let grew = false;
    let succeeded = 0;
    let failed = 0;
    let lastError = null;

    // The device lists first: lost / back, new inverters (cached for an hour).
    const plantIds = new Set(targets.map(([, entry]) => entry.summary?.plantId ?? entry.id));
    for (const plantId of plantIds) {
      try {
        const devices = await this.account.listDevices(plantId);
        this.trackLost(devices);
        grew = this.offerNewInverters(devices) || grew;
      } catch (err) {
        if (isFatal(err)) {
          await this.reportFailure(err);
          return;
        }
        logger.debug(`Device list of plant ${plantId} unavailable (${err.message})`);
      }
    }

    for (const [externalId, entry] of targets) {
      try {
        const reading =
          entry.kind === PLANT
            ? await this.account.readPlant(entry.id)
            : await this.account.readDevice(entry.id);
        succeeded += 1;
        this.issues.ok(`read:${externalId}`, `Reading ${this.nameOf(entry)} works again`);
        this.readings.set(externalId, reading);
        if (entry.kind === INVERTER) {
          await this.checkStatus(externalId, entry, reading);
          grew = this.growFeatures(externalId, entry, reading) || grew;
        }
        states.push(...this.statesOf(externalId, reading));
      } catch (err) {
        if (isFatal(err)) {
          await this.reportFailure(err);
          return;
        }
        if (err.code === ERROR_CODES.RATE_LIMITED) {
          // Growatt asks to wait: the next refresh is 5 minutes away anyway.
          logger.debug(`${this.nameOf(entry)}: ${err.message}`);
          continue;
        }
        failed += 1;
        lastError = err;
        this.issues.fail(
          `read:${externalId}`,
          `Reading ${this.nameOf(entry)} failed (${err.message})`,
        );
      }
    }

    if (succeeded > 0) {
      this.issues.ok('cloud', 'The Growatt cloud answers again');
      this.issues.ok('account', 'The Growatt account is usable again');
      await this.setConnection(true, 'ok');
    } else if (failed > 0) {
      this.issues.fail('cloud', `The Growatt cloud does not answer (${lastError.message})`);
      await this.setConnection(false, 'unreachable', TEXT.unreachable);
    }

    if (states.length > 0) {
      try {
        const { count } = await this.gladys.publishChangedStates(states, {
          heartbeat: HEARTBEAT_MS,
        });
        logger.debug(`Refresh: ${count} state(s) published out of ${states.length}`);
        this.issues.ok('publish', 'Publishing the states works again');
      } catch (err) {
        this.issues.fail('publish', `Publishing the states failed (${err.message})`);
      }
    }
    if (grew) {
      await this.republish();
    }
  }

  statesOf(externalId, reading) {
    const ids = { feature: (key) => `${externalId}:${key}` };
    const keys = this.createdKeys(externalId);
    return statesFor(ids, keys, reading, { language: this.config.language, guard: this.guard });
  }

  /** New features seen in a reading: remembered, and offered through Discovery. */
  growFeatures(externalId, entry, reading) {
    const before = entry.keys.size;
    entry.keys = this.store.rememberFeatures(
      externalId,
      featureKeysFor(entry.summary.family, reading),
    );
    return entry.keys.size !== before;
  }

  /** An inverter that appeared in the device list: offered at the next publication. */
  offerNewInverters(devices) {
    let added = false;
    for (const summary of devices) {
      const externalId = this.gladys.externalIds(INVERTER, summary.sn).device;
      if (summary.detailed && !this.structure.has(externalId)) {
        const keys = this.store.rememberFeatures(externalId, ['status']);
        this.structure.set(externalId, { kind: INVERTER, id: summary.sn, summary, keys });
        logger.info(`New Growatt inverter found: ${inverterName(summary)}`);
        added = true;
      } else if (this.structure.has(externalId)) {
        this.structure.get(externalId).summary = summary;
      }
    }
    return added;
  }

  async republish() {
    try {
      await this.gladys.publishDiscoveredDevices(this.discoveredDevices());
    } catch (err) {
      logger.warn(`Publishing the devices failed (${err.message})`);
    }
  }

  /** Life cycle logs: an inverter that stops reporting to the cloud, and comes back. */
  trackLost(devices) {
    for (const device of devices) {
      if (!device.detailed) {
        continue;
      }
      const before = this.lost.get(device.sn);
      this.lost.set(device.sn, device.lost);
      if (before === undefined || before === device.lost) {
        continue;
      }
      if (device.lost) {
        logger.info(`${inverterName(device)} stopped reporting to the Growatt cloud`);
      } else {
        logger.info(`${inverterName(device)} reports to the Growatt cloud again`);
      }
    }
  }

  /** Fires the status trigger on a change (never on the first reading after a start). */
  async checkStatus(externalId, entry, reading) {
    const status = reading.status ?? STATUS.UNKNOWN;
    const previous = this.statuses.get(externalId);
    this.statuses.set(externalId, status);
    if (previous === undefined || previous === status) {
      return;
    }
    logger.debug(`${this.nameOf(entry)}: status ${previous} -> ${status}`);
    const labels = inLanguage(STATUS_LABELS, this.config.language);
    try {
      await this.gladys.publishSceneEvent(TRIGGER_STATUS, {
        device: externalId,
        status,
        previous_status: previous,
        status_label: labels[status] ?? status,
        device_name: this.nameOf(entry),
      });
    } catch (err) {
      this.issues.fail('trigger', `Status trigger refused (${err.message})`);
    }
  }

  nameOf(entry) {
    return entry.kind === PLANT ? entry.plant.name : inverterName(entry.summary);
  }

  // --- Failures and connection status ------------------------------------------

  async reportFailure(err) {
    if (err.code === ERROR_CODES.AUTH) {
      this.issues.fail('account', `Growatt refused the credentials (${err.message})`);
      await this.setConnection(
        false,
        'auth',
        this.config.auth_mode === 'token' ? TEXT.authToken : TEXT.authPassword,
      );
      return;
    }
    if (err.code === ERROR_CODES.LOCKED) {
      const until = this.account?.lockedUntil();
      const text = until ? clockTime(until) : '';
      this.issues.fail('account', `Growatt locked the account, paused until ${text}`);
      await this.setConnection(false, `locked:${text}`, MESSAGES.locked(text));
      return;
    }
    this.issues.fail('cloud', `The Growatt cloud does not answer (${err.message})`);
    await this.setConnection(false, 'unreachable', TEXT.unreachable);
  }

  async setConnection(connected, key, message) {
    if (this.connectionKey === key) {
      return;
    }
    this.connectionKey = key;
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (err) {
      this.connectionKey = null;
      logger.debug(`Connection status not sent (${err.message})`);
    }
  }

  // --- Handlers ----------------------------------------------------------------

  /** A device was added in Gladys: its states now, not at the next refresh. */
  async onDeviceCreated(device) {
    if (!this.structure.has(device?.external_id)) {
      return;
    }
    this.createdHints.set(device.external_id, device);
    await this.refresh({ only: [device.external_id] });
    this.gladys.requestWidgetRefresh?.(WIDGET_KEY);
  }

  /** The "Test the connection" action. */
  async testConnection() {
    logger.info('Action: test the connection');
    if (!this.account) {
      return TEXT.notConfigured;
    }
    try {
      const result = await this.account.discover();
      const detailed = result.devices.filter((entry) => entry.summary.detailed).length;
      const unsupported = result.devices
        .filter((entry) => !entry.summary.detailed)
        .map((entry) => `${entry.summary.sn} (${entry.summary.family})`);
      if (result.plants.length === 0) {
        return TEXT.noPlant;
      }
      // The account answers: offer what it holds now.
      this.applyDiscovery(result);
      await this.republish();
      this.issues.ok('account', 'The Growatt account is usable again');
      await this.setConnection(true, 'ok');
      return MESSAGES.report({ plants: result.plants.length, devices: detailed, unsupported });
    } catch (err) {
      await this.reportFailure(err);
      if (err.code === ERROR_CODES.AUTH) {
        return this.config.auth_mode === 'token' ? TEXT.authToken : TEXT.authPassword;
      }
      if (err.code === ERROR_CODES.LOCKED) {
        const until = this.account.lockedUntil();
        return MESSAGES.locked(until ? clockTime(until) : '');
      }
      return MESSAGES.failed(err.message);
    }
  }

  /** The content of the "Solar overview" widget. */
  widgetContent({ settings = {}, language = 'en' } = {}) {
    const externalId = settings.device;
    if (!externalId) {
      return messageContent(TEXT.widgetPickDevice, language);
    }
    const created = this.createdKeys(externalId);
    const keys = new Set(
      created.length > 0 ? created : (this.structure.get(externalId)?.keys ?? []),
    );
    if (keys.size === 0) {
      return messageContent(TEXT.widgetUnknownDevice, language);
    }
    return buildOverview({
      deviceExternalId: externalId,
      keys,
      snapshot: this.readings.get(externalId) ?? null,
      language,
    });
  }
}

/** "14:05", local time of the container (TZ is the time zone of Gladys). */
function clockTime(timestamp) {
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Registers the handlers on the Gladys client and returns the app, so that
 * index.js stays a few lines and the tests drive the very same wiring.
 * @param {object} gladys GladysIntegration, or createFakeGladys() in the tests
 * @param {object} [options] test seams: store, fetch, timers, now
 */
export function registerHandlers(gladys, options = {}) {
  const app = new GrowattApp({
    gladys,
    store: options.store ?? new Store(),
    fetch: options.fetch,
    timers: options.timers ?? true,
    now: options.now,
  });

  // Every handler waits for the first start, so a request arriving during
  // the first discovery is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      // Every (re)connection starts over: Gladys may have restarted and lost
      // what it had; the readings of the last 5 minutes are served from memory.
      await app.start(await gladys.getConfig());
    } catch (err) {
      logger.error(`Initialization failed (${err.message})`);
      await gladys.setConnectionStatus(false, TEXT.initFailed).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.on('disconnected', () => app.poller.stop());

  gladys.onScanRequest(
    whenReady(async () => {
      logger.info('Scan requested: reading the Growatt account');
      await app.discoverAndPublish();
    }),
  );

  // The container's timer does the work; the core's poll is the fallback.
  gladys.onPoll(whenReady(() => app.poller.pollFromCore()));

  gladys.onDeviceCreated(whenReady((device) => app.onDeviceCreated(device)));

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      logger.info('Configuration updated: starting over');
      await app.start(newConfig);
    }),
  );

  gladys.onAction(
    ACTION_TEST,
    whenReady(() => app.testConnection()),
  );

  gladys.onWidgetGet(
    WIDGET_KEY,
    whenReady((request) => app.widgetContent(request)),
  );

  return { app, ready, stop: () => app.stop() };
}
