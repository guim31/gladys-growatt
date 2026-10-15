// -----------------------------------------------------------------------------
// The glitches of the Growatt energy counters, filtered before publication
// (the Home Assistant integration fights the same ones):
//
//   - a lifetime counter (an index) sometimes reads 0 around midnight, or a
//     hair below its last value: published as is, Gladys would count the
//     whole index again as new production on the next reading;
//   - a daily counter resets to 0 at midnight, then the cloud may serve
//     yesterday's final value once more before the real 0.1 kWh of the new
//     day ("midnight bounce").
//
// A real meter change (a new inverter) is a big drop to a value above 0: it
// goes through, and Gladys detects the counter reset on its side.
// -----------------------------------------------------------------------------

/** A drop of a lifetime counter smaller than this, in kWh, is noise. */
const TOTAL_NOISE_KWH = 1;

export function createCounterGuard() {
  const last = new Map();
  const beforeReset = new Map();

  return {
    /**
     * @param {string} id the feature external id
     * @param {'total'|'today'} kind
     * @param {number} value
     * @returns {number} the value to publish
     */
    filter(id, kind, value) {
      const previous = last.get(id);
      let output = value;
      if (kind === 'total' && previous !== undefined && previous > 0) {
        if (value === 0 || (value < previous && previous - value < TOTAL_NOISE_KWH)) {
          output = previous;
        }
      }
      if (kind === 'today' && previous !== undefined) {
        if (previous > 0 && value === 0) {
          beforeReset.set(id, previous);
        } else if (beforeReset.has(id)) {
          if (value === beforeReset.get(id)) {
            output = previous;
          } else if (value > 0) {
            beforeReset.delete(id);
          }
        }
      }
      last.set(id, output);
      return output;
    },

    /** Forget a feature (its device was removed). */
    forget(id) {
      last.delete(id);
      beforeReset.delete(id);
    },
  };
}
