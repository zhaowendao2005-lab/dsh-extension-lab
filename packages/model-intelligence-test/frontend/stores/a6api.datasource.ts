// Routing boundary: owner-only a6api operations → Host Remote; browser links/clipboard → service.
export { readA6Bridge, readA6Selections, readA6Preferences, writeA6Preferences, createA6Record, performA6Action, copyA6Configuration, consumeA6SelectionLink, watchA6SelectionLinks, readConsumedA6Selections, rememberConsumedA6Selection } from '../service/a6api.service';
