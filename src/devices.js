// -----------------------------------------------------------------------------
// The Gladys devices built from the Growatt readings.
//
//   - one PLANT device per Growatt plant: production power, production today
//     and the production index (the plant totals of Growatt);
//   - one INVERTER device per inverter the API reads in detail: solar power,
//     PV strings, status, temperature, production today and index, and,
//     when the installation has them, the battery and the grid meter.
//
// The plant and its inverters count the same production: add one or the
// other to the energy monitoring of Gladys, not both (said in the docs).
//
// External ids are forever: the plant id and the serial number Growatt
// gives, and feature keys in English that never change
// (gladys.externalIds('plant' | 'inverter', id)).
//
// A feature is created for what the device reports, never on a guess: the
// keys of its reading, filtered by the group rules below, merged with the
// keys published before (kept in /data, see src/store.js), so a reading
// made at night never removes the battery or a PV string.
// -----------------------------------------------------------------------------

import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import { NAMES, STATUS_LABELS, inLanguage } from './i18n.js';

export const PLANT = 'plant';
export const INVERTER = 'inverter';

const W = 'watt';
const KWH = 'kilowatt-hour';

// min/max are display bounds (gauges, charts): the core never enforces them,
// and they are NOT NULL in the database (a feature without them is a 422).
const POWER = { unit: W, min: 0, max: 20000 };
const INDEX = { unit: KWH, min: 0, max: 100000000 };
const TODAY = { unit: KWH, min: 0, max: 500 };

/** Every feature key, its Gladys category/type and unit, and its counter kind. */
export const FEATURES = {
  // Plant
  power: { category: 'energy-production-sensor', type: 'power', ...POWER },
  // Plant and inverter
  production_today: {
    category: 'energy-production-sensor',
    type: 'daily-production',
    ...TODAY,
    counter: 'today',
  },
  production_total: {
    category: 'energy-production-sensor',
    type: 'index',
    ...INDEX,
    counter: 'total',
  },
  // Inverter
  status: { category: 'text', type: 'text', min: 0, max: 0 },
  pv_power: { category: 'energy-production-sensor', type: 'power', ...POWER },
  ac_power: { category: 'home-output-sensor', type: 'power', ...POWER },
  temperature: {
    category: 'device-temperature-sensor',
    type: 'decimal',
    unit: 'celsius',
    min: -20,
    max: 100,
  },
  battery_level: {
    category: 'battery-storage',
    type: 'battery-level',
    unit: 'percent',
    min: 0,
    max: 100,
  },
  battery_charge_power: { category: 'battery-storage', type: 'charge-power', ...POWER },
  battery_discharge_power: { category: 'battery-storage', type: 'discharge-power', ...POWER },
  battery_charge_total: {
    category: 'battery-storage',
    type: 'charge-index',
    ...INDEX,
    counter: 'total',
  },
  battery_discharge_total: {
    category: 'battery-storage',
    type: 'discharge-index',
    ...INDEX,
    counter: 'total',
  },
  grid_import_power: { category: 'grid-sensor', type: 'input-power', ...POWER },
  grid_export_power: { category: 'grid-sensor', type: 'output-power', ...POWER },
  grid_import_total: { category: 'grid-sensor', type: 'input-index', ...INDEX, counter: 'total' },
  grid_export_total: { category: 'grid-sensor', type: 'output-index', ...INDEX, counter: 'total' },
  load_power: { category: 'energy-sensor', type: 'power', ...POWER },
  load_total: { category: 'energy-sensor', type: 'index', ...INDEX, counter: 'total' },
};

const PV_STRING = /^pv(\d)_(voltage|current)$/;
const PV_SPECS = {
  voltage: { category: 'energy-sensor', type: 'voltage', unit: 'volt', min: 0, max: 1000 },
  current: { category: 'energy-sensor', type: 'current', unit: 'ampere', min: 0, max: 30 },
};

/** The spec of a feature key, PV strings included; undefined for an unknown key. */
export function featureSpec(key) {
  const string = key.match(PV_STRING);
  if (string) {
    return PV_SPECS[string[2]];
  }
  return FEATURES[key];
}

/** The display order of the features of an inverter. */
const ORDER = [
  'power',
  'status',
  'pv_power',
  'ac_power',
  'production_today',
  'production_total',
  'battery_level',
  'battery_charge_power',
  'battery_discharge_power',
  'battery_charge_total',
  'battery_discharge_total',
  'grid_import_power',
  'grid_export_power',
  'grid_import_total',
  'grid_export_total',
  'load_power',
  'load_total',
  'temperature',
];

function orderOf(key) {
  const string = key.match(PV_STRING);
  if (string) {
    // After the solar power, string by string.
    return 1.5 + Number(string[1]) / 100 + (string[2] === 'current' ? 0.001 : 0);
  }
  const index = ORDER.indexOf(key);
  return index === -1 ? ORDER.length : index;
}

/** Families that always carry a battery (the SPH hybrids). */
const BATTERY_FAMILIES = new Set(['sph', 'mix']);

const positive = (value) => typeof value === 'number' && value > 0;

/**
 * The feature keys a fresh reading justifies. A MIN without battery still
 * sends `bmsSoc: 0`: the battery group needs a sign of life (a level, a
 * charged energy) or an SPH; the grid and home groups need a meter that
 * counted something; PV strings 3 and up need a voltage (unused MPPT inputs
 * read 0).
 */
export function featureKeysFor(family, reading) {
  const has = (key) => typeof reading[key] === 'number';
  const battery =
    BATTERY_FAMILIES.has(family) ||
    positive(reading.battery_level) ||
    positive(reading.battery_charge_total) ||
    positive(reading.battery_discharge_total);
  const grid = ['grid_import_power', 'grid_export_power', 'grid_import_total', 'grid_export_total']
    .map((key) => reading[key])
    .some(positive);
  const home = positive(reading.load_power) || positive(reading.load_total);

  const keys = ['status'];
  for (const key of Object.keys(reading)) {
    if (!has(key) || !featureSpec(key) || key === 'power') {
      continue;
    }
    const string = key.match(PV_STRING);
    if (string) {
      const n = Number(string[1]);
      if (n <= 2 || positive(reading[`pv${n}_voltage`]) || positive(reading[`pv${n}_current`])) {
        keys.push(key);
      }
      continue;
    }
    if (key.startsWith('battery_') && !battery) {
      continue;
    }
    if (key.startsWith('grid_') && !grid) {
      continue;
    }
    if (key.startsWith('load_') && !home) {
      continue;
    }
    keys.push(key);
  }
  return keys;
}

/** The plant keys a reading carries. */
export function plantKeysFor(reading) {
  return ['power', 'production_today', 'production_total'].filter(
    (key) => typeof reading[key] === 'number',
  );
}

/** The name of a feature in the configured language. */
export function featureName(key, language) {
  const names = inLanguage(NAMES, language);
  const string = key.match(PV_STRING);
  if (string) {
    return string[2] === 'voltage' ? names.pv_voltage(string[1]) : names.pv_current(string[1]);
  }
  return names[key];
}

/** Family labels for the device names: the Growatt product line. */
const FAMILY_LABELS = {
  min: 'Growatt MIN',
  tlx: 'Growatt MIN',
  sph: 'Growatt SPH',
  mix: 'Growatt SPH',
  inverter: 'Growatt',
};

/** The name of an inverter device: its alias in ShinePhone, else line + serial. */
export function inverterName(summary) {
  return summary.name ?? `${FAMILY_LABELS[summary.family] ?? 'Growatt'} ${summary.sn}`;
}

function buildFeatures(ids, keys, language) {
  return [...keys]
    .filter((key) => featureSpec(key))
    .sort((a, b) => orderOf(a) - orderOf(b))
    .map((key) => {
      const { category, type, unit, min, max } = featureSpec(key);
      const feature = {
        name: featureName(key, language),
        external_id: ids.feature(key),
        category,
        type,
        min,
        max,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      };
      if (unit) {
        feature.unit = unit;
      }
      return feature;
    });
}

// The container refreshes the devices itself (src/poller.js); the core's
// poll is a fallback the poller skips while its timer runs. Every minute is
// the slowest pace the core accepts.
const POLLING = { should_poll: true, poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES };

/**
 * @param {object} gladys
 * @param {{ id: string, name: string }} plant
 * @param {Iterable<string>} keys
 * @param {string} language
 */
export function buildPlantDevice(gladys, plant, keys, language) {
  const ids = gladys.externalIds(PLANT, plant.id);
  return {
    name: plant.name,
    external_id: ids.device,
    model: 'Growatt plant',
    ...POLLING,
    features: buildFeatures(ids, keys, language),
  };
}

/**
 * @param {object} gladys
 * @param {object} summary the device of the Growatt device list
 * @param {Iterable<string>} keys
 * @param {string} language
 */
export function buildInverterDevice(gladys, summary, keys, language) {
  const ids = gladys.externalIds(INVERTER, summary.sn);
  return {
    name: inverterName(summary),
    external_id: ids.device,
    model: summary.model ?? FAMILY_LABELS[summary.family] ?? 'Growatt',
    ...POLLING,
    features: buildFeatures(ids, keys, language),
  };
}

/**
 * The states of a reading for the given features.
 * @param {{ feature: (key: string) => string }} ids
 * @param {Iterable<string>} keys the features of the device
 * @param {object} reading
 * @param {object} options
 * @param {string} options.language
 * @param {{ filter: Function }} [options.guard] the counter glitch filter
 */
export function statesFor(ids, keys, reading, { language, guard }) {
  const states = [];
  for (const key of keys) {
    const id = ids.feature(key);
    if (key === 'status') {
      const label = inLanguage(STATUS_LABELS, language)[reading.status];
      if (label) {
        states.push({ device_feature_external_id: id, text: label });
      }
      continue;
    }
    let value = reading[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      continue;
    }
    const counter = featureSpec(key)?.counter;
    if (counter && guard) {
      value = guard.filter(id, counter, value);
    }
    states.push({ device_feature_external_id: id, state: value });
  }
  return states;
}
