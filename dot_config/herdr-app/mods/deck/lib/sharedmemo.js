// A memo for shared(key) reads, valid until the current synchronous job ends.
// Herdr copies a shared value into JS on every shared() call (the 60 KB issue
// store costs ~0.65 ms a read), and one Chat render read it ~11 times. Within
// one synchronous job (a render, a timer tick) no other code can write shared
// state, except this runtime's own setShared: writers call clear(). The memo
// empties itself at the next microtask, so no read outlives the job, and in
// any case after maxAge ms (should a runtime run microtasks late). Pure; no herdr imports.

/**
 * @param {(key: string) => any} read shared()
 * @param {{ later?: (fn: () => void) => void, now?: () => number, maxAge?: number }} [o]
 *   later runs fn after the current job (default: a microtask)
 */
export function createSharedMemo(read, { later = (fn) => Promise.resolve().then(fn), now = Date.now, maxAge = 50 } = {}) {
  let cache = null;
  let at = 0;
  return {
    /** shared(key), read at most once per job. */
    get(key) {
      if (cache && now() - at > maxAge) cache = null;
      if (!cache) {
        cache = new Map();
        at = now();
        later(() => {
          cache = null;
        });
      }
      if (!cache.has(key)) cache.set(key, read(key));
      return cache.get(key);
    },
    /** Forget every memoized read (call after this runtime writes shared state). */
    clear() {
      cache = null;
    },
  };
}
