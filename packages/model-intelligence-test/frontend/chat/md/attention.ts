/**
 * Asterisk attention resolver, copied from `micromark-core-commonmark`'s
 * `attention` construct together with the two helpers it imports
 * (`micromark-util-chunked`'s `splice`/`push` and `micromark-util-resolve-all`'s
 * `resolveAll`), which this package depends on separately. {@link cjkFriendlyStrong}
 * reuses the resolver to keep CommonMark emphasis working when it replaces the
 * asterisk text construct.
 */
import type {
  Code,
  Construct,
  Effects,
  Event,
  Point,
  Resolver,
  State,
  Token,
  TokenizeContext,
} from 'micromark-util-types'
import { classifyCharacter } from 'micromark-util-classify-character'

/**
 * Like `Array#splice`, but smarter for giant arrays: `Array#splice` takes all
 * items to be inserted as individual arguments, which overflows the stack for
 * very large inserts. Otherwise this does not return the removed items and takes
 * `items` as an array instead of rest parameters.
 * @param list - List to operate on.
 * @param start - Index to remove/insert at (can be negative).
 * @param remove - Number of items to remove.
 * @param items - Items to inject into `list`.
 */
function splice<T>(list: Array<T>, start: number, remove: number, items: Array<T>): void {
  const end = list.length;
  let chunkStart = 0;
  let parameters: Array<unknown>;

  // Make start between zero and `end` (included).
  if (start < 0) {
    start = -start > end ? 0 : end + start;
  } else {
    start = start > end ? end : start;
  }
  remove = remove > 0 ? remove : 0;

  // No need to chunk the items if there’s only a couple (10k) items.
  if (items.length < 10000) {
    parameters = Array.from(items);
    parameters.unshift(start, remove);
    (list.splice as (...args: Array<unknown>) => void)(...parameters);
  } else {
    // Delete `remove` items starting from `start`
    if (remove) list.splice(start, remove);

    // Insert the items in chunks to not cause stack overflows.
    while (chunkStart < items.length) {
      parameters = items.slice(chunkStart, chunkStart + 10000);
      parameters.unshift(start, 0);
      (list.splice as (...args: Array<unknown>) => void)(...parameters);
      chunkStart += 10000;
      start += 10000;
    }
  }
}

/**
 * Append `items` (an array) at the end of `list` (another array). When `list`
 * was empty, returns `items` instead: this prevents a potentially expensive
 * operation when `list` is empty, and adds items in batches to prevent V8 from
 * hanging.
 * @param list - List to operate on.
 * @param items - Items to add to `list`.
 * @returns Either `list` or `items`.
 */
function push<T>(list: Array<T>, items: Array<T>): Array<T> {
  if (list.length > 0) {
    splice(list, list.length, 0, items);
    return list;
  }
  return items;
}

/**
 * Call all `resolveAll`s.
 * @param constructs - List of constructs, optionally with `resolveAll`s.
 * @param events - List of events.
 * @param context - Context used by `tokenize`.
 * @returns Changed events.
 */
function resolveAll(
  constructs: ReadonlyArray<{ resolveAll?: Resolver | undefined }>,
  events: Array<Event>,
  context: TokenizeContext
): Array<Event> {
  const called: Array<Resolver> = [];
  let index = -1;

  while (++index < constructs.length) {
    const resolve = constructs[index].resolveAll;

    if (resolve && !called.includes(resolve)) {
      events = resolve(events, context);
      called.push(resolve);
    }
  }

  return events;
}

export const attention: Construct = {
  name: 'attention',
  resolveAll: resolveAllAttention,
  tokenize: tokenizeAttention,
};

/**
 * Take all events and resolve attention to emphasis or strong.
 *
 * @type {Resolver}
 */
// eslint-disable-next-line complexity
function resolveAllAttention(events: Array<Event>, context: TokenizeContext): Array<Event> {
  let index = -1;
  let nextEvents: Array<Event> = [];

  // Walk through all events.
  //
  // Note: performance of this is fine on an mb of normal markdown, but it’s
  // a bottleneck for malicious stuff.
  while (++index < events.length) {
    // Find a token that can close.
    if (events[index][0] === 'enter' && events[index][1].type === 'attentionSequence' && events[index][1]._close) {
      let open = index;

      // Now walk back to find an opener.
      while (open--) {
        // Find a token that can open the closer.
        if (events[open][0] === 'exit' && events[open][1].type === 'attentionSequence' && events[open][1]._open &&
        // If the markers are the same:
        context.sliceSerialize(events[open][1]).charCodeAt(0) === context.sliceSerialize(events[index][1]).charCodeAt(0)) {
          // If the opening can close or the closing can open,
          // and the close size *is not* a multiple of three,
          // but the sum of the opening and closing size *is* multiple of three,
          // then don’t match.
          if ((events[open][1]._close || events[index][1]._open) && (events[index][1].end.offset - events[index][1].start.offset) % 3 && !((events[open][1].end.offset - events[open][1].start.offset + events[index][1].end.offset - events[index][1].start.offset) % 3)) {
            continue;
          }

          // Number of markers to use from the sequence.
          const use = events[open][1].end.offset - events[open][1].start.offset > 1 && events[index][1].end.offset - events[index][1].start.offset > 1 ? 2 : 1;
          const start = {
            ...events[open][1].end
          };
          const end = {
            ...events[index][1].start
          };
          movePoint(start, -use);
          movePoint(end, use);
          const openingSequence: Token = {
            type: use > 1 ? "strongSequence" : "emphasisSequence",
            start,
            end: {
              ...events[open][1].end
            }
          };
          const closingSequence: Token = {
            type: use > 1 ? "strongSequence" : "emphasisSequence",
            start: {
              ...events[index][1].start
            },
            end
          };
          const text: Token = {
            type: use > 1 ? "strongText" : "emphasisText",
            start: {
              ...events[open][1].end
            },
            end: {
              ...events[index][1].start
            }
          };
          const group: Token = {
            type: use > 1 ? "strong" : "emphasis",
            start: {
              ...openingSequence.start
            },
            end: {
              ...closingSequence.end
            }
          };
          events[open][1].end = {
            ...openingSequence.start
          };
          events[index][1].start = {
            ...closingSequence.end
          };
          nextEvents = [];

          // If there are more markers in the opening, add them before.
          if (events[open][1].end.offset - events[open][1].start.offset) {
            nextEvents = push<Event>(nextEvents, [['enter', events[open][1], context], ['exit', events[open][1], context]]);
          }

          // Opening.
          nextEvents = push<Event>(nextEvents, [['enter', group, context], ['enter', openingSequence, context], ['exit', openingSequence, context], ['enter', text, context]]);

          // Always populated by defaults.

          // Between.
          nextEvents = push<Event>(nextEvents, resolveAll(context.parser.constructs.insideSpan.null ?? [], events.slice(open + 1, index), context));

          // Closing.
          nextEvents = push<Event>(nextEvents, [['exit', text, context], ['enter', closingSequence, context], ['exit', closingSequence, context], ['exit', group, context]]);

          /** @type {number} */
          let offset = 0;

          // If there are more markers in the closing, add them after.
          if (events[index][1].end.offset - events[index][1].start.offset) {
            offset = 2;
            nextEvents = push(nextEvents, [['enter', events[index][1], context], ['exit', events[index][1], context]]);
          }
          splice(events, open - 1, index - open + 3, nextEvents);
          index = open + nextEvents.length - offset - 2;
          break;
        }
      }
    }
  }

  // Remove remaining sequences.
  index = -1;
  while (++index < events.length) {
    if (events[index][1].type === 'attentionSequence') {
      events[index][1].type = 'data';
    }
  }
  return events;
}

/**
 * @this {TokenizeContext}
 *   Context.
 * @type {Tokenizer}
 */
function tokenizeAttention(this: TokenizeContext, effects: Effects, ok: State): State {
  // Always populated by defaults.
  const attentionMarkers = this.parser.constructs.attentionMarkers.null ?? [];
  const previous = this.previous;
  const before = classifyCharacter(previous);

  let marker: Code;
  return start;

  /**
   * Before a sequence.
   *
   * ```markdown
   * > | **
   *     ^
   * ```
   *
   * @type {State}
   */
  function start(code: Code): State | undefined {
    marker = code;
    effects.enter('attentionSequence');
    return inside(code);
  }

  /**
   * In a sequence.
   *
   * ```markdown
   * > | **
   *     ^^
   * ```
   *
   * @type {State}
   */
  function inside(code: Code): State | undefined {
    if (code === marker) {
      effects.consume(code);
      return inside;
    }
    const token = effects.exit('attentionSequence');

    // To do: next major: move this to resolver, just like `markdown-rs`.
    const after = classifyCharacter(code);

    // Always populated by defaults.

    // Note: `*` and `_` are in `attentionMarkers` through core.
    // They are excluded here as the loosening is meant for markers registered
    // by *other* constructs (such as GFM strikethrough’s `~`).
    const open = !after || after === 2 && before || attentionMarkers.includes(code) && code !== 42 && code !== 95;
    const close = !before || before === 2 && after || attentionMarkers.includes(previous) && previous !== 42 && previous !== 95;
    token._open = Boolean(marker === 42 ? open : open && (before || !close));
    token._close = Boolean(marker === 42 ? close : close && (after || !open));
    return ok(code);
  }
}

/**
 * Move a point a bit.
 *
 * Note: `move` only works inside lines! It’s not possible to move past other
 * chunks (replacement characters, tabs, or line endings).
 *
 * @param {Point} point
 *   Point.
 * @param {number} offset
 *   Amount to move.
 * @returns {undefined}
 *   Nothing.
 */
function movePoint(point: Point, offset: number): void {
  point.column += offset;
  point.offset += offset;
  point._bufferIndex += offset;
}