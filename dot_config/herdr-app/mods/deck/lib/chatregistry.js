// A small name -> function registry: the Chat view's block renderers
// (views/chatblocks.js) and composer completions (views/chatcomposer.js) are
// each one. Pure; no herdr imports.

/** The block types v1 registers a renderer for (views/chatblocks.js). */
export const BLOCK_TYPES = Object.freeze(["text", "action", "divider", "approval", "github", "deck"]);

/**
 * @param {(type: any, item: any, ...rest: any[]) => any} fallback runs for a type nothing registered
 */
export function createRegistry(fallback) {
  /** @type {Map<string, Function>} */
  const fns = new Map();
  return {
    /** Adds `type`, or replaces what it ran. @param {string} type @param {Function} fn */
    register(type, fn) {
      if (typeof type !== "string" || !type) throw new TypeError("registry: type must be a non-empty string");
      if (typeof fn !== "function") throw new TypeError(`registry: ${type} needs a function`);
      fns.set(type, fn);
    },
    /** @param {string} type */
    has: (type) => fns.has(type),
    /** The registered types, in the order they were first registered. */
    kinds: () => [...fns.keys()],
    /** Runs `type`'s function with (item, ...rest), else fallback(type, item, ...rest). */
    run(type, item, ...rest) {
      const fn = fns.get(type);
      return fn ? fn(item, ...rest) : fallback(type, item, ...rest);
    },
  };
}
