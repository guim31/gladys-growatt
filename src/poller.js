// -----------------------------------------------------------------------------
// The container's own refresh timer.
//
// The devices are published with `should_poll: true` and a valid
// `poll_frequency`, but the core cannot be trusted to call onPoll: Gladys
// 5.2.x skips devices created without `should_poll`, and a device keeps the
// polling fields it was created with (GladysAssistant/Gladys#3198). So the
// container refreshes by itself, at the configured pace, and the core's
// onPoll is a fallback that runs a refresh only when the timer has not run
// for 90 % of a period (it stalled). The core polls every minute: without
// this gate, Growatt would be called every minute.
//
// One refresh reads the whole account (every plant and inverter added to
// Gladys): Growatt limits the requests per account, not per device.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'poller' });

/**
 * @param {object} options
 * @param {(options: { force: boolean }) => Promise<void>} options.refresh one refresh, may throw
 * @param {() => number} options.periodMs
 * @param {boolean} [options.timers] run the periodic timer (tests turn it off)
 * @param {() => number} [options.now]
 */
export function createPoller({ refresh, periodMs, timers = true, now = () => Date.now() }) {
  let timer = null;
  let stopped = true;
  let lastRunAt;
  let running = null;

  async function run({ force = false } = {}) {
    if (running) {
      return running;
    }
    lastRunAt = now();
    running = (async () => {
      try {
        await refresh({ force });
      } catch (err) {
        // The refresh logs its own failures (once while they last).
        logger.debug(`Refresh failed (${err.message})`);
      }
    })();
    try {
      await running;
    } finally {
      running = null;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!timers || stopped) {
      return;
    }
    timer = setTimeout(async () => {
      timer = null;
      await run();
      schedule();
    }, periodMs());
    timer.unref?.();
  }

  return {
    /** (Re)start: refresh now, then every period. */
    async restart() {
      stopped = false;
      schedule();
      await run({ force: true });
    },

    /** The core's onPoll: refresh only when the timer stalled. */
    async pollFromCore() {
      if (stopped) {
        return;
      }
      if (lastRunAt !== undefined && now() - lastRunAt < periodMs() * 0.9) {
        logger.debug('onPoll skipped: the timer refreshed recently');
        return;
      }
      await run();
    },

    /** A refresh right now (the poller's timer is left as is). */
    runNow: () => run({ force: true }),

    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
    },

    /** Resolves once a refresh in progress is over (shutdown, tests). */
    idle: () => running ?? Promise.resolve(),
  };
}
