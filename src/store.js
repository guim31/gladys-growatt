// -----------------------------------------------------------------------------
// What the integration keeps across restarts, in /data (the only writable
// volume of the container): one JSON file, written atomically, readable by
// the container user only.
//
//   - agentId   the random suffix of the ShinePhone user agent, kept stable;
//   - session   the ShinePhone session cookie and user id, with the key of the
//               account it belongs to (a hash: no username in clear). Never
//               the password, never the token: those stay in the config;
//   - lock      until when the account is paused after a Growatt "507";
//   - features  the feature keys published so far per device, so a reading
//               made at night (battery at 0, no PV string voltage) never
//               removes a feature from the discovered device.
// -----------------------------------------------------------------------------

import { randomInt } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'store' });

export const DATA_DIR = '/data';
const FILE = 'growatt.json';

export class Store {
  /** @param {{ dir?: string|null }} [options] dir null: memory only (tests) */
  constructor({ dir = DATA_DIR } = {}) {
    this.dir = dir;
    this.data = {};
    this.writing = Promise.resolve();
    this.failing = false;
  }

  async load() {
    if (this.dir) {
      try {
        this.data = JSON.parse(await readFile(join(this.dir, FILE), 'utf8')) ?? {};
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger.warn(`Saved state unreadable, starting afresh (${err.message})`);
        }
        this.data = {};
      }
    }
    if (typeof this.data.agentId !== 'string') {
      this.data.agentId = String(randomInt(10_000, 100_000));
      this.save();
    }
    this.data.features ??= {};
    return this;
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    if (value === undefined || value === null) {
      delete this.data[key];
    } else {
      this.data[key] = value;
    }
    this.save();
  }

  /** The feature keys seen so far for a device, merged with `keys`. Saved when it grew. */
  rememberFeatures(deviceKey, keys) {
    const known = new Set(this.data.features[deviceKey] ?? []);
    const before = known.size;
    for (const key of keys) {
      known.add(key);
    }
    if (known.size !== before) {
      this.data.features[deviceKey] = [...known];
      this.save();
    }
    return known;
  }

  /** Writes are queued: the last one always lands last. */
  save() {
    if (!this.dir) {
      return this.writing;
    }
    const snapshot = JSON.stringify(this.data);
    this.writing = this.writing.then(async () => {
      try {
        await mkdir(this.dir, { recursive: true });
        const tmp = join(this.dir, `${FILE}.tmp`);
        await writeFile(tmp, snapshot, { mode: 0o600 });
        await rename(tmp, join(this.dir, FILE));
        if (this.failing) {
          this.failing = false;
          logger.info('Saving the state under /data works again');
        }
      } catch (err) {
        if (!this.failing) {
          this.failing = true;
          logger.warn(`Cannot save the state under /data (${err.message})`);
        }
      }
    });
    return this.writing;
  }

  /** Resolves once the queued writes are done (shutdown, tests). */
  flush() {
    return this.writing;
  }
}
