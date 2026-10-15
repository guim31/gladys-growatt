// -----------------------------------------------------------------------------
// From the Growatt answers to one normalized reading.
//
// Growatt has as many vocabularies as device families and APIs: `bmsSoc` on a
// MIN, `bmsSOC` on an SPH, `SOC` on the ShinePhone MIX page; watts here,
// kilowatts there; numbers sent as strings, sometimes with their unit. Every
// answer is turned here into the same flat object, in fixed units:
//
//   power W, voltage V, current A, energy kWh, battery %, temperature °C,
//   `status` one of STATUS, `time` the datalogger timestamp as sent.
//
// A key is present only when the answer carried it: the device builder
// (src/devices.js) creates a feature for a key that exists, never for a
// guess. The field names come from the growattServer library (MIT) and the
// Home Assistant integration `growatt_server` (Apache-2.0).
// -----------------------------------------------------------------------------

/** The states an inverter can be in, as published (and as scene filter values). */
export const STATUS = {
  NORMAL: 'normal',
  WAITING: 'waiting',
  FAULT: 'fault',
  OFFLINE: 'offline',
  UNKNOWN: 'unknown',
};

/**
 * Growatt status codes. TL-X / MIN: 0 waiting, 1 normal, 3 fault; SPH adds
 * 5 to 8 for its normal modes (PV, battery, PV + battery, bypass); -1 is the
 * code the ShinePhone pages use for a device that stopped reporting.
 */
const STATUS_BY_CODE = new Map([
  [-1, STATUS.OFFLINE],
  [0, STATUS.WAITING],
  [1, STATUS.NORMAL],
  [3, STATUS.FAULT],
  [5, STATUS.NORMAL],
  [6, STATUS.NORMAL],
  [7, STATUS.NORMAL],
  [8, STATUS.NORMAL],
]);

/**
 * A number from a Growatt value: 12.5, "12.5", "12.5kWh", "12.5 kW".
 * @returns {number|undefined} undefined for null, "", "null", "--" or garbage
 */
export function num(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = value.trim().match(/^-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

/**
 * The status of a device, from its code and the "lost" flag of the device
 * lists (the cloud has not heard from its datalogger for a while).
 */
export function statusOf(code, lost) {
  if (lost === true || lost === 'true' || lost === 1) {
    return STATUS.OFFLINE;
  }
  const value = num(code);
  if (value === undefined) {
    return STATUS.UNKNOWN;
  }
  return STATUS_BY_CODE.get(value) ?? STATUS.UNKNOWN;
}

/** First defined number among the keys of `raw`, times `scale`. */
function pick(raw, keys, scale = 1) {
  for (const key of keys) {
    const value = num(raw[key]);
    if (value !== undefined) {
      return round(value * scale);
    }
  }
  return undefined;
}

/** Sum of the defined numbers among the keys; undefined when none is. */
function sum(raw, keys, scale = 1) {
  const values = keys.map((key) => num(raw[key])).filter((value) => value !== undefined);
  return values.length === 0 ? undefined : round(values.reduce((a, b) => a + b, 0) * scale);
}

/** Rounds away the float noise of a ×1000 (0.1 + 0.2 kW is 300 W, not 300.00000000000006). */
function round(value) {
  return Math.round(value * 1000) / 1000;
}

/** Drop the undefined keys, so `key in reading` means "Growatt sent it". */
function compact(reading) {
  return Object.fromEntries(Object.entries(reading).filter(([, value]) => value !== undefined));
}

/**
 * Some OpenAPI answers wrap the device in a list (`{ tlx: [ {...} ] }`,
 * `{ min: [...] }`); most give it flat. Returns the device object either way.
 */
export function unwrapDevice(data) {
  if (!data || typeof data !== 'object') {
    return {};
  }
  for (const key of ['tlx', 'min', 'mix', 'sph']) {
    const inner = data[key];
    if (Array.isArray(inner) && inner[0] && typeof inner[0] === 'object') {
      return inner[0];
    }
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      return inner;
    }
  }
  return data;
}

/** PV string voltages and currents, as many as the answer carries (up to 8). */
function strings(raw, voltageKey, currentKey) {
  const out = {};
  for (let n = 1; n <= 8; n += 1) {
    const voltage = pick(raw, voltageKey(n));
    const current = pick(raw, currentKey(n));
    if (voltage !== undefined) {
      out[`pv${n}_voltage`] = voltage;
    }
    if (current !== undefined) {
      out[`pv${n}_current`] = current;
    }
  }
  return out;
}

/**
 * MIN / TL-X / TL-XH / MOD / MIC (OpenAPI type 7 `tlx_last_data`, and the
 * ShinePhone `getTlxDetailData`): one vocabulary for both.
 */
export function readingFromTlx(raw) {
  const data = unwrapDevice(raw);
  // The solar production is the PV energy; a hybrid's AC energy also counts
  // what the battery gave back. The AC energy only when no PV energy is sent.
  const hasPvEnergy = num(data.epvTotal) !== undefined;
  return compact({
    status: statusOf(data.status, data.lost),
    time: typeof data.time === 'string' ? data.time : undefined,
    pv_power: pick(data, ['ppv']),
    ...strings(
      data,
      (n) => [`vpv${n}`],
      (n) => [`ipv${n}`],
    ),
    ac_power: pick(data, ['pac']),
    production_today: hasPvEnergy ? pick(data, ['epvToday']) : pick(data, ['eacToday']),
    production_total: hasPvEnergy ? pick(data, ['epvTotal']) : pick(data, ['eacTotal']),
    temperature: pick(data, ['temp1', 'temperature']),
    battery_level: pick(data, ['bmsSoc', 'soc']),
    battery_charge_power: sum(data, ['bdc1ChargePower', 'bdc2ChargePower']),
    battery_discharge_power: sum(data, ['bdc1DischargePower', 'bdc2DischargePower']),
    battery_charge_total: pick(data, ['echargeTotal']),
    battery_discharge_total: pick(data, ['edischargeTotal']),
    grid_import_power: pick(data, ['pacToUserTotal']),
    grid_export_power: pick(data, ['pacToGridTotal']),
    grid_import_total: pick(data, ['etoUserTotal']),
    grid_export_total: pick(data, ['etoGridTotal']),
    load_power: pick(data, ['pacToLocalLoad']),
    load_total: pick(data, ['elocalLoadTotal']),
  });
}

/**
 * SPH hybrid (OpenAPI type 5): `mix_last_data` merged over `mix_data_info`.
 * Powers in W, as the Home Assistant integration reads them.
 */
export function readingFromSph(raw) {
  const data = unwrapDevice(raw);
  return compact({
    status: statusOf(data.status, data.lost),
    time: typeof data.time === 'string' ? data.time : undefined,
    pv_power: pick(data, ['ppv']),
    ...strings(
      data,
      (n) => [`vpv${n}`],
      (n) => [`ipv${n}`],
    ),
    ac_power: pick(data, ['pac']),
    production_today: pick(data, ['epvtoday', 'epvToday']),
    production_total: pick(data, ['epvTotal', 'epvtotal']),
    temperature: pick(data, ['temp1']),
    battery_level: pick(data, ['bmsSOC', 'bmsSoc', 'soc']),
    battery_charge_power: pick(data, ['pcharge1']),
    battery_discharge_power: pick(data, ['pdischarge1']),
    battery_charge_total: pick(data, ['echarge1Total']),
    battery_discharge_total: pick(data, ['edischarge1Total']),
    grid_import_power: pick(data, ['pacToUserR', 'pacToUserTotal']),
    grid_export_power: pick(data, ['pacToGridTotal', 'pacToGridR']),
    grid_import_total: pick(data, ['etoUserTotal', 'etouserTotal']),
    grid_export_total: pick(data, ['etogridTotal', 'etoGridTotal']),
    load_power: pick(data, ['pacToLocalLoad', 'plocalLoadTotal']),
    load_total: pick(data, ['elocalLoadTotal']),
  });
}

/** Classic string inverter (ShinePhone `getInverterDetailData`). */
export function readingFromInverter(raw) {
  const data = raw?.data && typeof raw.data === 'object' ? raw.data : (raw ?? {});
  return compact({
    status: statusOf(data.status, data.lost),
    time: typeof data.time === 'string' ? data.time : undefined,
    pv_power: pick(data, ['ppv']),
    ...strings(
      data,
      (n) => [`vpv${n}`],
      (n) => [`ipv${n}`],
    ),
    ac_power: pick(data, ['pac']),
    production_today: pick(data, ['powerToday', 'eToday']),
    production_total: pick(data, ['powerTotal', 'eTotal']),
    temperature: pick(data, ['temperature']),
  });
}

/**
 * SPH through the ShinePhone API: `getSystemStatus_KW` (powers in kW) and
 * `getEnergyOverview` (energies in kWh).
 */
export function readingFromMix(status = {}, totals = {}) {
  return compact({
    // The status page says "mix.status.normal" in `lost`: the status code
    // and the device list tell more.
    status: statusOf(status.status),
    pv_power: pick(status, ['ppv'], 1000),
    pv1_voltage: pick(status, ['vPv1']),
    pv2_voltage: pick(status, ['vPv2']),
    production_today: pick(totals, ['epvToday']),
    production_total: pick(totals, ['epvTotal']),
    battery_level: pick(status, ['SOC']),
    battery_charge_power: pick(status, ['chargePower'], 1000),
    battery_discharge_power: pick(status, ['pdisCharge1'], 1000),
    battery_charge_total: pick(totals, ['echargetotal', 'echargeTotal']),
    battery_discharge_total: pick(totals, ['edischarge1Total']),
    grid_import_power: pick(status, ['pactouser'], 1000),
    grid_export_power: pick(status, ['pactogrid'], 1000),
    grid_export_total: pick(totals, ['etogridTotal']),
    load_power: pick(status, ['pLocalLoad'], 1000),
    load_total: pick(totals, ['elocalLoadTotal']),
  });
}

/** A power reading of `plant/power` older than this is not "now" any more. */
const MAX_POWER_AGE_MS = 10 * 60_000;

/**
 * Plant totals from the OpenAPI: `plant/data` (current power in kW) and, when
 * it answered, the newest recent point of `plant/power` (W), which Home
 * Assistant found more reliable: `current_power` can stay at 0 while the
 * plant produces.
 * @param {object} data plant/data
 * @param {object|null} powerOverview plant/power, or null
 * @param {Date} now
 */
export function plantFromOpenApi(data = {}, powerOverview = null, now = new Date()) {
  let power = pick(data, ['current_power'], 1000);
  const latest = latestPower(powerOverview, now);
  if (latest !== undefined) {
    power = latest;
  }
  return compact({
    power,
    production_today: pick(data, ['today_energy']),
    production_total: pick(data, ['total_energy']),
  });
}

/** The power of the newest point of `plant/power` dated in the last 10 minutes. */
function latestPower(overview, now) {
  let latestTime;
  let latestPowerValue;
  for (const point of overview?.powers ?? []) {
    const power = num(point?.power);
    const time = parseLocalTime(point?.time);
    if (power === undefined || time === undefined) {
      continue;
    }
    const age = now.getTime() - time.getTime();
    if (age < 0 || age > MAX_POWER_AGE_MS) {
      continue;
    }
    if (latestTime === undefined || time > latestTime) {
      latestTime = time;
      latestPowerValue = power;
    }
  }
  return latestPowerValue;
}

/**
 * "2026-10-15 12:35" or "2026-10-15 12:35:00", in the local time of the
 * container (the supervisor sets TZ to the time zone of Gladys, which is the
 * plant's in practice).
 */
export function parseLocalTime(text) {
  if (typeof text !== 'string') {
    return undefined;
  }
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) {
    return undefined;
  }
  const [, y, mo, d, h, mi, s] = match.map(Number);
  const date = new Date(y, mo - 1, d, h, mi, Number.isNaN(s) ? 0 : s);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Plant totals from the ShinePhone `getAllDeviceListTwo` page. */
export function plantFromClassic(info = {}) {
  return compact({
    power: pick(info, ['invTodayPpv']),
    production_today: pick(info, ['todayEnergy']),
    production_total: pick(info, ['totalEnergy']),
  });
}
