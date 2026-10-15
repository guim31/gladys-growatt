// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the texts of the code,
// the feature names, and the four user docs with the same sections. German
// says "du", never the polite "Sie".
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES, MESSAGES, NAMES, STATUS_LABELS, TEXT } from '../src/i18n.js';
import { FEATURES, featureName } from '../src/devices.js';
import { STATUS } from '../src/growatt/model.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  message: 300,
  short: 24,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

test('the configuration offers the four languages, French by default', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  const language = manifest.config_schema.find((field) => field.key === 'language');
  assert.equal(language.default, 'fr');
  assert.deepEqual(
    language.options.map((option) => option.value),
    LANGS,
  );
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 50, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the name is the brand, the same in every language', () => {
  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
});

test('the fixed texts and the built messages have the four languages', () => {
  const short = new Set([
    'tileProduction',
    'tileToday',
    'tileBattery',
    'tileImport',
    'tileExport',
    'tileHome',
    'statusLabel',
    'lastDataLabel',
    'chartTitle',
  ]);
  const found = [
    ...Object.entries(TEXT).flatMap(([key, value]) =>
      problems(value, `TEXT.${key}`, short.has(key) ? MAX.short : MAX.message),
    ),
    ...problems(MESSAGES.locked('14:05'), 'MESSAGES.locked', MAX.message),
    ...problems(MESSAGES.failed('v1/plant/list: timeout'), 'MESSAGES.failed', MAX.message),
    ...problems(
      MESSAGES.report({
        plants: 2,
        devices: 3,
        unsupported: ['A1 (max)', 'B2 (spa)', 'C3 (noah)'],
      }),
      'MESSAGES.report',
      MAX.message,
    ),
    ...problems(
      MESSAGES.report({ plants: 1, devices: 1, unsupported: [] }),
      'MESSAGES.report (all detailed)',
      MAX.message,
    ),
  ];
  assert.deepEqual(found, []);
});

test('the feature names exist in every language, distinct on a device', () => {
  assert.deepEqual(sorted(Object.keys(NAMES)), sorted(LANGS));
  const keys = [...Object.keys(FEATURES), 'pv1_voltage', 'pv1_current', 'pv4_voltage'];
  for (const lang of LANGS) {
    assert.deepEqual(sorted(Object.keys(NAMES[lang])), sorted(Object.keys(NAMES.en)), lang);
    const names = keys.map((key) => featureName(key, lang));
    for (const [index, name] of names.entries()) {
      assert.deepEqual(textProblems(name, `${lang}.${keys[index]}`, lang, MAX.featureName), []);
    }
    assert.equal(new Set(names).size, names.length, `${lang}: two features share a name`);
  }
});

test('the inverter statuses exist in every language', () => {
  assert.deepEqual(sorted(Object.keys(STATUS_LABELS)), sorted(LANGS));
  for (const lang of LANGS) {
    assert.deepEqual(sorted(Object.keys(STATUS_LABELS[lang])), sorted(Object.values(STATUS)));
    for (const [status, label] of Object.entries(STATUS_LABELS[lang])) {
      assert.deepEqual(textProblems(label, `${lang}.${status}`, lang, MAX.short), []);
    }
  }
  // The trigger filter offers the statuses the code publishes.
  const trigger = manifest.scene_triggers.find((t) => t.key === 'inverter_status_changed');
  const options = trigger.fields.find((field) => field.key === 'status').options;
  for (const option of options) {
    assert.ok(Object.values(STATUS).includes(option.value), option.value);
  }
});

// The docs: the four languages, the same sections, the mandatory notices.
const docs = Object.fromEntries(
  await Promise.all(
    LANGS.map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);
const headings = (text) =>
  text
    .split('\n')
    .filter((line) => /^#{1,6} /.test(line))
    .map((line) => line.match(/^#+/)[0].length);

test('the four docs have the same sections', () => {
  const reference = headings(docs.en);
  assert.ok(reference.filter((level) => level === 2).length >= 9, 'the sections of the brief');
  for (const lang of LANGS) {
    assert.deepEqual(headings(docs[lang]), reference, `docs/${lang}.md`);
    assert.ok(docs[lang].length >= 3000, `docs/${lang}.md is short`);
  }
});

test('the docs say "not affiliated" and "developed without the hardware"', () => {
  const notices = {
    en: [/not affiliated with\s+(?:>\s*)?Growatt/, /Developed without the hardware/],
    fr: [/pas\s+(?:>\s*)?affiliée à Growatt/, /Développée sans le matériel/],
    de: [/keiner\s+(?:>\s*)?Verbindung zu Growatt/, /Ohne die Hardware entwickelt/],
    es: [/no está\s+(?:>\s*)?afiliada a Growatt/, /Desarrollada sin el hardware/],
  };
  for (const lang of LANGS) {
    for (const notice of notices[lang]) {
      assert.match(docs[lang], notice, `docs/${lang}.md`);
    }
  }
});

test('the German doc says "du", the Spanish doc "usted"', () => {
  assert.doesNotMatch(docs.de, POLITE_GERMAN);
  assert.match(docs.de, /\bdu\b|\bdein/);
  assert.doesNotMatch(docs.es, /(?<!\p{L})(tú|tienes|puedes|tu cuenta)(?!\p{L})/u);
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Power', fr: 'Puissance', de: 'Leistung' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: '', es: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of ['Wählen Sie', 'Ihr Konto', 'Ihre Anlage', 'mit Ihrem', 'Ihren', 'Ihrer']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  // A manifest text forgotten in German is found.
  const forgotten = structuredClone(manifest);
  delete forgotten.config_schema[6].placeholder.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.config_schema[6].placeholder has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
  // Two docs with different sections are told apart.
  assert.notDeepEqual(headings('# A\n## B\n## C'), headings('# A\n## B\n### C'));
});
