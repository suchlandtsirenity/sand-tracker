// Debounced, retrying save queue. Holds the newest unsaved value per level key
// until the server accepts it, so nothing is lost while offline.

export function createSaver({ save, delay = 500, initialBackoff = 1000, maxBackoff = 30000, onStatus = () => {} }) {
  const pending = new Map(); // key -> snapshot
  let timer = null;
  let inFlight = null;
  let backoff = initialBackoff;

  function arm(ms) {
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  }

  async function run() {
    timer = null;
    if (inFlight || pending.size === 0) return inFlight;
    onStatus('saving');
    inFlight = (async () => {
      let failed = false;
      for (const [key, value] of [...pending]) {
        try {
          await save(key, value);
          if (pending.get(key) === value) pending.delete(key); // unchanged since we sent it
        } catch {
          failed = true;
        }
      }
      inFlight = null;
      if (failed) {
        onStatus('offline');
        arm(backoff);
        backoff = Math.min(backoff * 2, maxBackoff);
      } else if (pending.size) {
        arm(delay); // changes arrived while saving
      } else {
        backoff = initialBackoff;
        onStatus('saved');
      }
    })();
    return inFlight;
  }

  return {
    schedule(key, level) {
      pending.set(key, structuredClone(level));
      onStatus('pending');
      if (!inFlight) arm(delay);
    },
    flush() {
      clearTimeout(timer);
      return run();
    },
    peek: (key) => pending.get(key),
  };
}
