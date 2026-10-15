// -----------------------------------------------------------------------------
// Growatt ShinePhone API: the account (username + password) of the ShinePhone
// app and of server.growatt.com. Reverse-engineered, undocumented, and
// guarded by Growatt with rate limits per endpoint:
//
//   - a login is a form POST to `newTwoLoginAPI.do` with a modified MD5 of the
//     password (growattServer `hash_password`); the session is a cookie;
//   - `success: false` with `msg: "502"` is a wrong account or password;
//   - `msg: "507"` (HTTP 200) means the account is locked — about 24 hours by
//     the growattServer reports, and retrying deepens it.
//
// Hence the rules of this client: the session cookie is kept (in /data
// through the `session` hooks) and reused, the login happens only when the
// session is missing or expired — never on every refresh as Home Assistant
// does — at most once per LOGIN_MIN_GAP_MS, and a 507 is surfaced as LOCKED
// for the caller to pause for hours.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { ERROR_CODES, GrowattError } from './errors.js';
import { describeAnswer, endpointOf, exchange, form } from './http.js';
import {
  plantFromClassic,
  readingFromInverter,
  readingFromMix,
  readingFromTlx,
  statusOf,
} from './model.js';

/** Two logins never closer than this (Growatt counts 5-minute windows). */
export const LOGIN_MIN_GAP_MS = 10 * 60_000;

const INVALID_CREDENTIALS = new Set(['501', '502']);
const LOCKED = '507';

/** The ShinePhone device types this client reads in detail. */
const DETAILED = new Set(['inverter', 'tlx', 'mix']);

/**
 * The ShinePhone password hash: the MD5 hex digest, where every byte whose
 * high nibble is 0 has that "0" replaced by "c".
 */
export function hashPassword(password) {
  const hex = createHash('md5').update(password, 'utf8').digest('hex').split('');
  for (let i = 0; i < hex.length; i += 2) {
    if (hex[i] === '0') {
      hex[i] = 'c';
    }
  }
  return hex.join('');
}

export class ClassicClient {
  /**
   * @param {object} options
   * @param {string} options.server base URL with its trailing slash
   * @param {string} options.username
   * @param {string} options.password
   * @param {string} options.agentId stable random suffix of the user agent
   * @param {{ cookies?: Record<string,string>, userId?: string, loggedAt?: number }} [options.session]
   *   a session saved earlier
   * @param {(session: object|null) => void} [options.onSession] called when the session changes
   * @param {typeof fetch} [options.fetch]
   * @param {() => number} [options.now]
   */
  constructor({
    server,
    username,
    password,
    agentId,
    session = null,
    onSession = () => {},
    fetch: fetchImpl = globalThis.fetch,
    now = () => Date.now(),
  }) {
    this.base = server;
    this.username = username;
    this.password = password;
    // The ShinePhone server checks for an app-like User-Agent (growattServer
    // docs): the Android form of the library, with this integration's name.
    this.userAgent = `Dalvik/2.1.0 (Linux; U; Android 12; gladys-growatt) - ${agentId}`;
    this.session = session && session.cookies ? { ...session } : null;
    this.onSession = onSession;
    this.fetch = fetchImpl;
    this.now = now;
    this.mode = 'password';
    this.plantsFromLogin = null;
  }

  headers() {
    // The headers of growattServer (requests): User-Agent and a generic
    // Accept, nothing a browser-only rule could single out.
    const headers = { 'User-Agent': this.userAgent, Accept: '*/*' };
    const cookies = Object.entries(this.session?.cookies ?? {});
    if (cookies.length > 0) {
      headers.Cookie = cookies.map(([name, value]) => `${name}=${value}`).join('; ');
    }
    return headers;
  }

  /** Remember the cookies the server sets. */
  absorbCookies(headers) {
    const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    if (list.length === 0) {
      return false;
    }
    const cookies = { ...(this.session?.cookies ?? {}) };
    for (const line of list) {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      if (index > 0) {
        cookies[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
      }
    }
    this.session = { ...(this.session ?? {}), cookies };
    return true;
  }

  async login() {
    const last = this.session?.loggedAt ?? this.lastLoginAttempt;
    if (last !== undefined && this.now() - last < LOGIN_MIN_GAP_MS) {
      throw new GrowattError(
        ERROR_CODES.SESSION,
        'session expired, next login held back to respect the Growatt limits',
      );
    }
    this.lastLoginAttempt = this.now();
    // A fresh login starts from no cookie at all.
    this.session = null;
    const url = `${this.base}newTwoLoginAPI.do`;
    const answer = await exchange(this.fetch, url, {
      method: 'POST',
      headers: this.headers(),
      body: form({ userName: this.username, password: hashPassword(this.password) }),
      redirect: 'manual',
    });
    const { status, headers, json } = answer;
    if (status === 403 || status === 401) {
      // Not a wrong password (that is a JSON answer with msg 502): the server
      // refuses the login request itself. Knocking again does not help.
      throw new GrowattError(
        ERROR_CODES.BLOCKED,
        `login: HTTP ${status} (${describeAnswer(answer)}), refused by the Growatt server`,
        { httpStatus: status },
      );
    }
    if (status >= 400) {
      throw new GrowattError(ERROR_CODES.NETWORK, `login: HTTP ${status}`, { httpStatus: status });
    }
    const back = json?.back;
    if (!back || typeof back !== 'object') {
      throw new GrowattError(
        ERROR_CODES.PROTOCOL,
        `login: unexpected answer (HTTP ${status}, ${describeAnswer(answer)})`,
        { httpStatus: status },
      );
    }
    if (!back.success) {
      const msg = String(back.msg ?? '');
      this.onSession(null);
      if (msg === LOCKED) {
        throw new GrowattError(ERROR_CODES.LOCKED, 'login: account locked by Growatt (507)', {
          apiCode: msg,
        });
      }
      if (INVALID_CREDENTIALS.has(msg)) {
        throw new GrowattError(ERROR_CODES.AUTH, `login: wrong username or password (${msg})`, {
          apiCode: msg,
        });
      }
      throw new GrowattError(ERROR_CODES.PROTOCOL, `login refused (${msg.slice(0, 40)})`, {
        apiCode: msg,
      });
    }
    this.absorbCookies(headers);
    const userId = back.user?.id ?? back.userId;
    this.session = {
      cookies: this.session?.cookies ?? {},
      userId: userId === undefined ? undefined : String(userId),
      loggedAt: this.now(),
    };
    this.plantsFromLogin = Array.isArray(back.data) ? back.data : null;
    this.onSession(this.session);
  }

  /**
   * One request in the session: logs in first when there is no session, and
   * once again when the server shows the session expired (a redirect to the
   * login page, an HTML page instead of JSON).
   */
  async call(method, page, fields = {}, { retried = false } = {}) {
    if (!this.session) {
      await this.login();
    }
    const url = new URL(page, this.base);
    const init = { method, headers: this.headers(), redirect: 'manual' };
    if (method === 'GET') {
      for (const [key, value] of Object.entries(fields)) {
        url.searchParams.set(key, String(value));
      }
    } else {
      init.body = form(fields);
    }
    const { status, headers, json } = await exchange(this.fetch, url.toString(), init);
    const where = endpointOf(url.toString());
    if (this.absorbCookies(headers)) {
      this.onSession(this.session);
    }
    const expired = (status >= 300 && status < 400) || status === 401 || json === undefined;
    if (expired) {
      if (retried) {
        throw new GrowattError(ERROR_CODES.PROTOCOL, `${where}: no data after a new login`);
      }
      this.session = null;
      this.onSession(null);
      return this.call(method, page, fields, { retried: true });
    }
    if (status >= 400) {
      throw new GrowattError(ERROR_CODES.NETWORK, `${where}: HTTP ${status}`);
    }
    const body =
      json?.back && typeof json.back === 'object' && !Array.isArray(json.back) ? json.back : json;
    if (body && body.success === false && String(body.msg ?? '') === LOCKED) {
      throw new GrowattError(ERROR_CODES.LOCKED, `${where}: account locked by Growatt (507)`, {
        apiCode: LOCKED,
      });
    }
    return json;
  }

  /** @returns {Promise<{ id: string, name: string }[]>} */
  async listPlants() {
    if (!this.session) {
      await this.login();
    }
    let plants = this.plantsFromLogin;
    if (!plants) {
      const json = await this.call('GET', 'PlantListAPI.do', {
        userId: this.session?.userId ?? '',
      });
      plants = json?.back?.data ?? [];
    }
    return (Array.isArray(plants) ? plants : [])
      .filter((plant) => plant && plant.plantId !== undefined)
      .map((plant) => ({
        id: String(plant.plantId),
        name: String(plant.plantName ?? plant.plantId),
      }));
  }

  /** The plant page: totals and device list, in one request. */
  async plantInfo(plantId) {
    const json = await this.call('GET', 'newTwoPlantAPI.do', {
      op: 'getAllDeviceListTwo',
      plantId,
      pageNum: 1,
      pageSize: 1,
    });
    return json && typeof json === 'object' ? json : {};
  }

  /** The devices of a plant (ShinePhone `deviceList`). */
  async listDevices(plantId, info = null) {
    let list = (info ?? (await this.plantInfo(plantId))).deviceList;
    if (!Array.isArray(list) || list.length === 0) {
      // A TL-X plant leaves the list of the plant page empty: the other page has it.
      const json = await this.call('GET', 'newTwoPlantAPI.do', {
        op: 'getAllDeviceList',
        plantId,
        language: 1,
      });
      list = json?.deviceList;
    }
    return (Array.isArray(list) ? list : [])
      .filter((device) => device && device.deviceSn)
      .map((device) => {
        const family = String(device.deviceType ?? 'other');
        const alias = device.deviceAilas ?? device.deviceAlias;
        return {
          sn: String(device.deviceSn),
          plantId: String(plantId),
          family,
          detailed: DETAILED.has(family),
          name:
            typeof alias === 'string' && alias.trim() !== '' && alias !== device.deviceSn
              ? alias.trim()
              : undefined,
          model: typeof device.deviceModel === 'string' ? device.deviceModel : undefined,
          status: statusOf(device.deviceStatus ?? device.status, device.lost),
          lost: device.lost === true || device.lost === 'true',
          lastUpdate: typeof device.lastUpdateTime === 'string' ? device.lastUpdateTime : undefined,
        };
      });
  }

  /** Plant totals and device list from the same page. */
  async readPlant(plantId) {
    const info = await this.plantInfo(plantId);
    return { ...plantFromClassic(info), devices: await this.listDevices(plantId, info) };
  }

  async readDevice(device) {
    if (device.family === 'inverter') {
      const json = await this.call('GET', 'newInverterAPI.do', {
        op: 'getInverterDetailData',
        inverterId: device.sn,
      });
      return readingFromInverter(json);
    }
    if (device.family === 'tlx') {
      const json = await this.call('GET', 'newTlxApi.do', {
        op: 'getTlxDetailData',
        id: device.sn,
      });
      return readingFromTlx(json?.data ?? json);
    }
    if (device.family === 'mix') {
      const status = await this.call('POST', `newMixApi.do?op=getSystemStatus_KW`, {
        mixId: device.sn,
        plantId: device.plantId,
      });
      const totals = await this.call('POST', `newMixApi.do?op=getEnergyOverview`, {
        mixId: device.sn,
        plantId: device.plantId,
      });
      return readingFromMix(status?.obj ?? {}, totals?.obj ?? {});
    }
    throw new GrowattError(ERROR_CODES.PROTOCOL, `no detailed data for a ${device.family} device`);
  }
}

/** A key that tells two accounts apart without storing the username in clear. */
export function accountKey(server, username) {
  return createHash('sha256').update(`${server}\n${username}`).digest('hex').slice(0, 16);
}
