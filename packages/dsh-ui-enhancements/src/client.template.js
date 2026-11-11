/**
 * dsh-ui-enhancements — client half (source template).
 *
 * Built by `scripts/build.mjs` into `lib/client.js`.
 * Styling only: this plugin does not own the extension market.
 */
window.__ModuleLoader__.load({
  id: "dsh-ui-enhancements",
  factory: () => {
    const module = { exports: {} };
    const CSS = __SWISS_CSS__;
    const STYLE_ID = "dsh-ui-enhancements/swiss-dialogs.css";
    const PLUGIN = "dsh-ui-enhancements";

    function apply(ctx) {
      ctx.effect(() => {
        for (const stale of document.querySelectorAll(
          `style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`,
        )) {
          stale.remove();
        }

        const tag = document.createElement("style");
        tag.dataset.plugin = PLUGIN;
        tag.dataset.pluginCss = STYLE_ID;
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => tag.remove();
      }, "dsh-ui-enhancements: swiss dialog stylesheet");
    }

    module.exports.name = PLUGIN;
    module.exports.apply = apply;
    return module.exports;
  },
});
