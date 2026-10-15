// -----------------------------------------------------------------------------
// The failures of the Growatt cloud, sorted by what the integration must do
// about them. The callers branch on `code`, never on the message wording.
// -----------------------------------------------------------------------------

export const ERROR_CODES = {
  /** Wrong token, password or account: stop calling until the config changes. */
  AUTH: 'auth',
  /** OpenAPI 10012: the endpoint was called less than 5 minutes ago. Try next cycle. */
  RATE_LIMITED: 'rate_limited',
  /**
   * ShinePhone "507": the account is locked, for about 24 hours according to
   * the growattServer library. Retrying deepens the lockout: pause for hours.
   */
  LOCKED: 'locked',
  /** The server cannot be reached, timed out, or answered with an HTTP error. */
  NETWORK: 'network',
  /** The server answered something this integration does not understand. */
  PROTOCOL: 'protocol',
  /** The ShinePhone session expired and the login is held back. */
  SESSION: 'session',
};

export class GrowattError extends Error {
  /**
   * @param {string} code one of ERROR_CODES
   * @param {string} message never carries a token, a password or a cookie
   * @param {{ apiCode?: string|number }} [details] the code Growatt answered
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GrowattError';
    this.code = code;
    this.apiCode = details.apiCode;
  }
}

export const isGrowattError = (err, code) =>
  err instanceof GrowattError && (code === undefined || err.code === code);
