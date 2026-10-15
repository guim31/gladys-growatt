// -----------------------------------------------------------------------------
// The "Solar overview" dashboard widget (Gladys 5.1+): for one plant or
// inverter chosen in its settings, the live tiles of what the device
// measures (production, today's energy, battery, grid, home), the production
// curve of the day from the history Gladys already keeps, and the status.
//
// The tiles and the chart are bound to the device features (`device_feature`):
// the core follows the published states live, the widget content itself only
// changes with the status, hence a long ttl. The content budget of the core
// (8 components, 6 tiles, 1 focal, 1 status) is respected by construction,
// and test/widgets.test.js runs the SDK's validateWidgetContent on it.
// -----------------------------------------------------------------------------

import { STATUS_LABELS, TEXT, inLanguage } from './i18n.js';

export const WIDGET_KEY = 'solar_overview';

/** Tiles in display order: the first feature key the device has wins each tile. */
const TILES = [
  { keys: ['pv_power', 'power'], label: 'tileProduction', icon: 'sun' },
  { keys: ['production_today'], label: 'tileToday', icon: 'bar-chart-2' },
  { keys: ['battery_level'], label: 'tileBattery', icon: 'battery' },
  { keys: ['grid_import_power'], label: 'tileImport', icon: 'download' },
  { keys: ['grid_export_power'], label: 'tileExport', icon: 'upload' },
  { keys: ['load_power'], label: 'tileHome', icon: 'home' },
];

const STATUS_COLORS = {
  normal: 'success',
  waiting: 'neutral',
  fault: 'danger',
  offline: 'warning',
  unknown: 'neutral',
};

/** A plain text card (nothing to show yet). */
export function messageContent(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: inLanguage(text, language) }],
  };
}

/**
 * @param {object} options
 * @param {string} options.deviceExternalId
 * @param {Set<string>} options.keys the feature keys of the device
 * @param {{ status?: string, time?: string } | null} options.snapshot the last reading
 * @param {string} options.language
 */
export function buildOverview({ deviceExternalId, keys, snapshot, language }) {
  const feature = (key) => `${deviceExternalId}:${key}`;
  const components = [];

  for (const tile of TILES) {
    const key = tile.keys.find((candidate) => keys.has(candidate));
    if (key) {
      components.push({
        type: 'value',
        label: inLanguage(TEXT[tile.label], language),
        icon: tile.icon,
        device_feature: feature(key),
      });
    }
  }

  const powerKey = ['pv_power', 'power'].find((key) => keys.has(key));
  if (powerKey) {
    components.push({
      type: 'chart',
      title: inLanguage(TEXT.chartTitle, language),
      chart_type: 'area',
      interval: 'last-day',
      device_features: [feature(powerKey)],
    });
  }

  const items = [];
  if (snapshot?.status && keys.has('status')) {
    items.push({
      label: inLanguage(TEXT.statusLabel, language),
      value: inLanguage(STATUS_LABELS, language)[snapshot.status] ?? snapshot.status,
      color: STATUS_COLORS[snapshot.status] ?? 'neutral',
    });
  }
  if (typeof snapshot?.time === 'string' && snapshot.time !== '') {
    items.push({
      label: inLanguage(TEXT.lastDataLabel, language),
      value: snapshot.time.slice(0, 40),
      icon: 'clock',
    });
  }
  if (items.length > 0) {
    components.push({ type: 'status', items });
  }

  return { ttl_seconds: 300, components };
}
