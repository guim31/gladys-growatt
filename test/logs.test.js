// -----------------------------------------------------------------------------
// Quiet logs: a normal refresh writes nothing at info level, a failure that
// lasts is said once (and its end once), and no secret of the configuration
// ever reaches the logs, whatever goes wrong — even at debug level.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../src/growatt/classic.js';
import { refreshPeriodMs, normalizeConfig } from '../src/config.js';
import { PASSWORD_CONFIG, TOKEN_CONFIG, addAll, createWorld } from './helpers/world.js';
import { PASSWORD, TOKEN } from './helpers/fakeGrowatt.js';

const PERIOD = refreshPeriodMs(normalizeConfig(TOKEN_CONFIG));

async function settle(rounds = 30) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Captures every log line (the SDK logger writes through console.log / console.error). */
function captureLogs(t) {
  const lines = [];
  // Only the logger's lines ("[time] [LEVEL] ..."), not Node's own warnings.
  const record = (...args) => {
    const line = args.map(String).join(' ');
    if (/^\[[^\]]+\] \[(DEBUG|INFO|WARN|ERROR)\]/.test(line)) {
      lines.push(line);
    }
  };
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  return lines;
}

const atLevel = (lines, level) => lines.filter((line) => line.includes(`[${level}]`));

test('a normal refresh writes nothing at info level', async (t) => {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'debug';
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date(2026, 9, 15, 12, 31) });
  const lines = captureLogs(t);
  const { gladys, integration } = await createWorld({ timers: true });
  try {
    await addAll(gladys);
    const start = lines.length;
    assert.ok(atLevel(lines, 'INFO').length >= 2, 'the start is said');

    for (let i = 0; i < 3; i += 1) {
      t.mock.timers.tick(PERIOD);
      await settle();
    }
    const cycle = lines.slice(start);
    assert.ok(
      cycle.some((line) => line.includes('[DEBUG]')),
      'debug shows the refreshes',
    );
    assert.deepEqual(
      cycle.filter((line) => !line.includes('[DEBUG]')),
      [],
      'nothing above debug for normal refreshes',
    );
  } finally {
    await integration.stop();
  }
});

test('a failure that lasts is one warning, its end one info line', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date(2026, 9, 15, 12, 31) });
  const lines = captureLogs(t);
  const { gladys, growatt, integration } = await createWorld({ timers: true });
  try {
    await addAll(gladys);
    const start = lines.length;
    growatt.set('v1/device/tlx/tlx_last_data', () => new Response('down', { status: 503 }));
    for (let i = 0; i < 4; i += 1) {
      t.mock.timers.tick(PERIOD);
      await settle();
    }
    growatt.set('v1/device/tlx/tlx_last_data', 'openapi/tlx-last-data.json');
    t.mock.timers.tick(PERIOD);
    await settle();
    const after = lines.slice(start);
    assert.equal(atLevel(after, 'WARN').length, 1, after.join('\n'));
    assert.match(atLevel(after, 'WARN')[0], /Reading Growatt MIN MIN0A1B2C3 failed \(.*HTTP 503\)/);
    assert.equal(atLevel(after, 'INFO').length, 1, after.join('\n'));
    assert.match(atLevel(after, 'INFO')[0], /works again/);
  } finally {
    await integration.stop();
  }
});

test('no secret of the configuration in the logs, whatever goes wrong', async (t) => {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'debug';
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = captureLogs(t);
  const secrets = [TOKEN, PASSWORD, hashPassword(PASSWORD), encodeURIComponent(PASSWORD)];

  const scenarios = [
    { config: TOKEN_CONFIG },
    { config: { ...TOKEN_CONFIG, api_token: `${TOKEN}-revoked` } },
    { config: PASSWORD_CONFIG },
    { config: { ...PASSWORD_CONFIG, password: `${PASSWORD}-old` } },
    {
      config: PASSWORD_CONFIG,
      routes: { 'newTwoLoginAPI.do': 'shinephone/login-locked.json' },
    },
    {
      // A server that echoes the request back in its error.
      config: TOKEN_CONFIG,
      routes: {
        'v1/plant/list': (request) => ({
          error_code: 10001,
          error_msg: `bad request token=${request.headers.get('token')}`,
        }),
      },
    },
  ];
  for (const scenario of scenarios) {
    const { gladys, integration } = await createWorld(scenario);
    await addAll(gladys);
    await gladys.fake.action('test_connection', {});
    await integration.stop();
  }

  assert.ok(lines.length > 10, 'the scenarios logged');
  for (const line of lines) {
    for (const secret of secrets) {
      assert.ok(!line.includes(secret), `a secret leaked: ${line}`);
    }
  }
});
