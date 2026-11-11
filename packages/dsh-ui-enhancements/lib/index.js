/**
 * dsh-ui-enhancements — host half.
 *
 * The host entry intentionally stays empty: all of the work happens in the
 * client half (`./lib/client.js`), which injects one plugin-owned stylesheet.
 * Keeping a host entry means the package can be composed by the bundle patch
 * exactly like any other dialog-adjacent plugin.
 */
export const name = "dsh-ui-enhancements";

export function apply() {}
