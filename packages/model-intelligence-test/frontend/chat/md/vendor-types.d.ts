/**
 * Local declarations for the three type-only specifiers the ported Markdown
 * renderer imports — `unist`, `micromark-util-types`, and `mdast` — copied
 * verbatim from `@types/unist`, `micromark-util-types` and `@types/mdast`. This
 * package depends on none of them at runtime, so the ambient declarations keep
 * every original import specifier unchanged. `mdast-util-gfm`, `mdast-util-math`
 * and the other installed parsers augment the `mdast` module declared here.
 */

declare module 'unist' {
// ## Interfaces

/**
 * Info associated with nodes by the ecosystem.
 *
 * This space is guaranteed to never be specified by unist or specifications
 * implementing unist.
 * But you can use it in utilities and plugins to store data.
 *
 * This type can be augmented to register custom data.
 * For example:
 *
 * ```ts
 * declare module 'unist' {
 *   interface Data {
 *     // `someNode.data.myId` is typed as `number | undefined`
 *     myId?: number | undefined
 *   }
 * }
 * ```
 */
export interface Data {}

/**
 * One place in a source file.
 */
export interface Point {
    /**
     * Line in a source file (1-indexed integer).
     */
    line: number;

    /**
     * Column in a source file (1-indexed integer).
     */
    column: number;
    /**
     * Character in a source file (0-indexed integer).
     */
    offset?: number | undefined;
}

/**
 * Position of a node in a source document.
 *
 * A position is a range between two points.
 */
export interface Position {
    /**
     * Place of the first character of the parsed source region.
     */
    start: Point;

    /**
     * Place of the first character after the parsed source region.
     */
    end: Point;
}

// ## Abstract nodes

/**
 * Abstract unist node that contains the smallest possible value.
 *
 * This interface is supposed to be extended.
 *
 * For example, in HTML, a `text` node is a leaf that contains text.
 */
export interface Literal extends Node {
    /**
     * Plain value.
     */
    value: unknown;
}

/**
 * Abstract unist node.
 *
 * The syntactic unit in unist syntax trees are called nodes.
 *
 * This interface is supposed to be extended.
 * If you can use {@link Literal} or {@link Parent}, you should.
 * But for example in markdown, a `thematicBreak` (`***`), is neither literal
 * nor parent, but still a node.
 */
export interface Node {
    /**
     * Node type.
     */
    type: string;

    /**
     * Info from the ecosystem.
     */
    data?: Data | undefined;

    /**
     * Position of a node in a source document.
     *
     * Nodes that are generated (not in the original source document) must not
     * have a position.
     */
    position?: Position | undefined;
}

/**
 * Abstract unist node that contains other nodes (*children*).
 *
 * This interface is supposed to be extended.
 *
 * For example, in XML, an element is a parent of different things, such as
 * comments, text, and further elements.
 */
export interface Parent extends Node {
    /**
     * List of children.
     */
    children: Node[];
}
}

declare module 'micromark-util-types' {
// Note: this file is authored manually, not generated from `index.js`.

/**
 * A character code.
 *
 * This is often the same as what `String#charCodeAt()` yields but micromark
 * adds meaning to certain other values.
 *
 * `null` represents the end of the input stream (called eof).
 * Negative integers are used instead of certain sequences of characters (such
 * as line endings and tabs).
 */
export type Code = number | null

/**
 * A chunk is either a character code or a slice of a buffer in the form of a
 * string.
 *
 * Chunks are used because strings are more efficient storage that character
 * codes, but limited in what they can represent.
 */
export type Chunk = Code | string

/**
 * Enumeration of the content types.
 *
 * Technically `document` is also a content type, which includes containers
 * (lists, block quotes) and flow.
 * As `ContentType` is used on tokens to define the type of subcontent but
 * `document` is the highest level of content, so it’s not listed here.
 *
 * Containers in markdown come from the margin and include more constructs
 * on the lines that define them.
 * Take for example a block quote with a paragraph inside it (such as
 * `> asd`).
 *
 * `flow` represents the sections, such as headings, code, and content, which
 * is also parsed per line
 * An example is HTML, which has a certain starting condition (such as
 * `<script>` on its own line), then continues for a while, until an end
 * condition is found (such as `</style>`).
 * If that line with an end condition is never found, that flow goes until
 * the end.
 *
 * `content` is zero or more definitions, and then zero or one paragraph.
 * It’s a weird one, and needed to make certain edge cases around definitions
 * spec compliant.
 * Definitions are unlike other things in markdown, in that they behave like
 * `text` in that they can contain arbitrary line endings, but *have* to end
 * at a line ending.
 * If they end in something else, the whole definition instead is seen as a
 * paragraph.
 *
 * The content in markdown first needs to be parsed up to this level to
 * figure out which things are defined, for the whole document, before
 * continuing on with `text`, as whether a link or image reference forms or
 * not depends on whether it’s defined.
 * This unfortunately prevents a true streaming markdown to HTML compiler.
 *
 * `text` contains phrasing content such as attention (emphasis, strong),
 * media (links, images), and actual text.
 *
 * `string` is a limited `text` like content type which only allows character
 * references and character escapes.
 * It exists in things such as identifiers (media references, definitions),
 * titles, or URLs.
 */
export type ContentType = 'content' | 'document' | 'flow' | 'string' | 'text'

/**
 * A location in the document (`line`/`column`/`offset`) and chunk (`_index`,
 * `_bufferIndex`).
 *
 * `_bufferIndex` is `-1` when `_index` points to a code chunk and it’s a
 * non-negative integer when pointing to a string chunk.
 *
 * The interface for the location in the document comes from unist `Point`:
 * <https://github.com/syntax-tree/unist#point>
 */
export interface Point {
  /**
   * Position in a string chunk (or `-1` when pointing to a numeric chunk).
   */
  _bufferIndex: number

  /**
   * Position in a list of chunks.
   */
  _index: number

  /**
   * 1-indexed column number.
   */
  column: number

  /**
   * 1-indexed line number.
   */
  line: number

  /**
   * 0-indexed position in the document.
   */
  offset: number
}

/**
 * A token: a span of chunks.
 *
 * Tokens are what the core of micromark produces: the built in HTML compiler
 * or other tools can turn them into different things.
 *
 * Tokens are essentially names attached to a slice of chunks, such as
 * `lineEndingBlank` for certain line endings, or `codeFenced` for a whole
 * fenced code.
 *
 * Sometimes, more info is attached to tokens, such as `_open` and `_close`
 * by `attention` (strong, emphasis) to signal whether the sequence can open
 * or close an attention run.
 *
 * Linked tokens are used because outer constructs are parsed first.
 * Take for example:
 *
 * ```markdown
 * > *a
 * b*.
 * ```
 *
 * 1.  The block quote marker and the space after it is parsed first
 * 2.  The rest of the line is a `chunkFlow` token
 * 3.  The two spaces on the second line are a `linePrefix`
 * 4.  The rest of the line is another `chunkFlow` token
 *
 * The two `chunkFlow` tokens are linked together.
 * The chunks they span are then passed through the flow tokenizer.
 */
export interface Token {
  /**
   * Token type.
   */
  type: TokenType

  /**
   * Point where the token starts.
   */
  start: Point

  /**
   * Point where the token ends.
   */
  end: Point

  /**
   * The previous token in a list of linked tokens.
   */
  previous?: Token | undefined

  /**
   * The next token in a list of linked tokens.
   */
  next?: Token | undefined

  /**
   * Declares a token as having content of a certain type.
   */
  contentType?: ContentType | undefined

  /**
   * Declares that trailing whitespace is sensitive,
   * is allowed,
   * when `contentType` is `text` (or `string`).
   * Normally,
   * trailing spaces and tabs are dropped.
   */
  _contentTypeTextTrailing?: boolean | undefined

  /**
   * Connected tokenizer.
   *
   * Used when dealing with linked tokens.
   * A child tokenizer is needed to tokenize them, which is stored on those
   * tokens.
   */
  _tokenizer?: TokenizeContext | undefined

  /**
   * Field to help parse attention.
   *
   * Depending on the character before sequences (`**`), the sequence can open,
   * close, both, or none.
   */
  _open?: boolean | undefined

  /**
   * Field to help parse attention.
   *
   * Depending on the character before sequences (`**`), the sequence can open,
   * close, both, or none.
   */
  _close?: boolean | undefined

  /**
   * Field to help parse GFM task lists.
   *
   * This boolean is used internally to figure out if a token is in the first
   * content of a list item construct.
   */
  _isInFirstContentOfListItem?: boolean | undefined

  /**
   * Field to help parse containers.
   *
   * This boolean is used internally to figure out if a token is a container
   * token.
   */
  _container?: boolean | undefined

  /**
   * Field to help parse lists.
   *
   * This boolean is used internally to figure out if a list is loose or not.
   */
  _loose?: boolean | undefined

  /**
   * Field to help parse links.
   *
   * This boolean is used internally to figure out if a link opening
   * can’t be used (because links in links are incorrect).
   */
  _inactive?: boolean | undefined

  /**
   * Field to help parse links.
   *
   * This boolean is used internally to figure out if a link opening is
   * balanced: it’s not a link opening but has a balanced closing.
   */
  _balanced?: boolean | undefined
}

/**
 * The start or end of a token amongst other events.
 *
 * Tokens can “contain” other tokens, even though they are stored in a flat
 * list, through `enter`ing before them, and `exit`ing after them.
 */
export type Event = ['enter' | 'exit', Token, TokenizeContext]

/**
 * Open a token.
 *
 * @param type
 *   Token type.
 * @param fields
 *   Extra fields.
 * @returns {Token}
 *   Token.
 */
export type Enter = (
  type: TokenType,
  fields?: Omit<Partial<Token>, 'type'> | undefined
) => Token

/**
 * Close a token.
 *
 * @param type
 *   Token type.
 * @returns
 *   Token.
 */
export type Exit = (type: TokenType) => Token

/**
 * Deal with the character and move to the next.
 *
 * @param code
 *   Current code.
 */
export type Consume = (code: Code) => undefined

/**
 * Attempt deals with several values, and tries to parse according to those
 * values.
 *
 * If a value resulted in `ok`, it worked, the tokens that were made are used,
 * and `ok` is switched to.
 * If the result is `nok`, the attempt failed, so we revert to the original
 * state, and `nok` is used.
 *
 * @param construct
 *   Construct(s) to try.
 * @param ok
 *   State to move to when successful.
 * @param nok
 *   State to move to when unsuccessful.
 * @returns
 *   Next state.
 */
export type Attempt = (
  construct: Array<Construct> | ConstructRecord | Construct,
  ok: State,
  nok?: State | undefined
) => State

/**
 * A context object to transition the state machine.
 */
export interface Effects {
  /**
   * Try to tokenize a construct.
   */
  attempt: Attempt

  /**
   * Attempt, then revert.
   */
  check: Attempt

  /**
   * Deal with the character and move to the next.
   */
  consume: Consume

  /**
   * Start a new token.
   */
  enter: Enter

  /**
   * End a started token.
   */
  exit: Exit

  /**
   * Interrupt is used for stuff right after a line of content.
   */
  interrupt: Attempt
}

/**
 * The main unit in the state machine: a function that gets a character code
 * and has certain effects.
 *
 * A state function should return another function: the next
 * state-as-a-function to go to.
 *
 * But there is one case where they return `undefined`: for the eof character
 * code (at the end of a value).
 * The reason being: well, there isn’t any state that makes sense, so
 * `undefined` works well.
 * Practically that has also helped: if for some reason it was a mistake, then
 * an exception is throw because there is no next function, meaning it
 * surfaces early.
 *
 * @param code
 *   Current code.
 * @returns
 *   Next state.
 */
export type State = (code: Code) => State | undefined

/**
 * A resolver handles and cleans events coming from `tokenize`.
 *
 * @param events
 *   List of events.
 * @param context
 *   Tokenize context.
 * @returns
 *   The given, modified, events.
 */
export type Resolver = (
  events: Array<Event>,
  context: TokenizeContext
) => Array<Event>

/**
 * A tokenize function sets up a state machine to handle character codes streaming in.
 *
 * @param this
 *   Tokenize context.
 * @param effects
 *   Effects.
 * @param ok
 *   State to go to when successful.
 * @param nok
 *   State to go to when unsuccessful.
 * @returns
 *   First state.
 */
export type Tokenizer = (
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State
) => State

/**
 * Like a tokenizer, but without `ok` or `nok`.
 *
 * @param this
 *   Tokenize context.
 * @param effects
 *   Effects.
 * @returns
 *   First state.
 */
export type Initializer = (this: TokenizeContext, effects: Effects) => State

/**
 * Like a tokenizer, but without `ok` or `nok`, and returning `undefined`.
 *
 * This is the final hook when a container must be closed.
 *
 * @param this
 *   Tokenize context.
 * @param effects
 *   Effects.
 * @returns
 *   Nothing.
 */
export type Exiter = (this: TokenizeContext, effects: Effects) => undefined

/**
 * Guard whether `code` can come before the construct.
 *
 * In certain cases a construct can hook into many potential start characters.
 * Instead of setting up an attempt to parse that construct for most
 * characters, this is a speedy way to reduce that.
 *
 * @param this
 *   Tokenize context.
 * @param code
 *   Previous code.
 * @returns
 *   Whether `code` is allowed before.
 */
export type Previous = (this: TokenizeContext, code: Code) => boolean

/**
 * An object describing how to parse a markdown construct.
 */
export interface Construct {
  /**
   * Whether the construct, when in a `ConstructRecord`, precedes over existing
   * constructs for the same character code when merged.
   *
   * The default is that new constructs precede over existing ones.
   */
  add?: 'after' | 'before' | undefined

  /**
   * Concrete constructs cannot be interrupted by more containers.
   *
   * For example, when parsing the document (containers, such as block quotes
   * and lists) and this construct is parsing fenced code:
   *
   * ````markdown
   * > ```js
   * > - list?
   * ````
   *
   * …then `- list?` cannot form if this fenced code construct is concrete.
   *
   * An example of a construct that is not concrete is a GFM table:
   *
   * ````markdown
   * | a |
   * | - |
   * > | b |
   * ````
   *
   * …`b` is not part of the table.
   */
  concrete?: boolean | undefined

  /**
   * For containers, a continuation construct.
   */
  continuation?: Construct | undefined

  /**
   * For containers, a final hook.
   */
  exit?: Exiter | undefined

  /**
   * Name of the construct, used to toggle constructs off.
   *
   * Named constructs must not be `partial`.
   */
  name?: string | undefined

  /**
   * Whether this construct represents a partial construct.
   *
   * Partial constructs must not have a `name`.
   */
  partial?: boolean | undefined

  /**
   * Guard whether the previous character can come before the construct.
   */
  previous?: Previous | undefined

  /**
   * Resolve all events when the content is complete, from the start to the end.
   * Only used if `tokenize` is successful once in the content.
   *
   * For example, if we’re currently parsing a link title and this construct
   * parses character references, then `resolveAll` is called *if* at least one
   * character reference is found, ranging from the start to the end of the link
   * title to the end.
   */
  resolveAll?: Resolver | undefined

  /**
   * Resolve the events from the start of the content (which includes other
   * constructs) to the last one parsed by `tokenize`.
   *
   * For example, if we’re currently parsing a link title and this construct
   * parses character references, then `resolveTo` is called with the events
   * ranging from the start of the link title to the end of a character
   * reference each time one is found.
   */
  resolveTo?: Resolver | undefined

  /**
   * Resolve the events parsed by `tokenize`.
   *
   * For example, if we’re currently parsing a link title and this construct
   * parses character references, then `resolve` is called with the events
   * ranging from the start to the end of a character reference each time one is
   * found.
   */
  resolve?: Resolver | undefined

  /**
   * Set up a state machine to handle character codes streaming in.
   */
  tokenize: Tokenizer
}

/**
 * Like a construct, but `tokenize` does not accept `ok` or `nok`.
 */
export interface InitialConstruct extends Omit<Construct, 'tokenize'> {
  tokenize: Initializer
}

/**
 * Several constructs, mapped from their initial codes.
 */
export type ConstructRecord = Record<
  string,
  Array<Construct> | Construct | undefined
>

/**
 * State shared between container calls.
 */
export interface ContainerState {
  /**
   * Special field to close the current flow (or containers).
   */
  _closeFlow?: boolean | undefined

  /**
   * Whether there are further blank lines, used by lists.
   */
  furtherBlankLines?: boolean | undefined

  /**
   * Whether there first line is blank, used by lists.
   */
  initialBlankLine?: boolean | undefined

  /**
   * Current marker, used by lists.
   */
  marker?: Code | undefined

  /**
   * Used by block quotes.
   */
  open?: boolean | undefined

  /**
   * Current size, used by lists.
   */
  size?: number | undefined

  /**
   * Current token type, used by lists.
   */
  type?: TokenType | undefined
}

/**
 * A context object that helps w/ tokenizing markdown constructs.
 */
export interface TokenizeContext {
  // To do: next major: remove `_gfmTableDynamicInterruptHack` (no longer
  // needed in micromark-extension-gfm-table@1.0.6).
  /**
   * Internal boolean shared with `micromark-extension-gfm-table` whose body
   * rows are not affected by normal interruption rules.
   * “Normal” rules are, for example, that an empty list item can’t interrupt:
   *
   * ````markdown
   * a
   * *
   * ````
   *
   * The above is one paragraph.
   * These rules don’t apply to table body rows:
   *
   * ````markdown
   * | a |
   * | - |
   * *
   * ````
   *
   * The above list interrupts the table.
   */
  _gfmTableDynamicInterruptHack?: boolean

  /**
   * Internal boolean shared with `micromark-extension-gfm-task-list-item` to
   * signal whether the tokenizer is tokenizing the first content of a list item
   * construct.
   */
  _gfmTasklistFirstContentOfListItem?: boolean | undefined

  /**
   * Declares that trailing whitespace is sensitive,
   * is allowed,
   * when tokenizing `text` (or `string`).
   * Normally,
   * trailing spaces and tabs are dropped.
   */
  _contentTypeTextTrailing?: boolean | undefined

  /**
   * Stack of label start tokens that can still close.
   */
  _labelStarts?: Array<Token> | undefined

  /**
   * Current code.
   */
  code: Code

  /**
   * Share state set when parsing containers.
   *
   * Containers are parsed in separate phases: their first line (`tokenize`),
   * continued lines (`continuation.tokenize`), and finally `exit`.
   * This record can be used to store some information between these hooks.
   */
  containerState?: ContainerState | undefined

  /**
   * The current construct.
   *
   * Constructs that are not `partial` are set here.
   */
  currentConstruct?: Construct | undefined

  /**
   * Current list of events.
   */
  events: Array<Event>

  /**
   * Whether we’re currently interrupting.
   *
   * Take for example:
   *
   * ```markdown
   * a
   * # b
   * ```
   *
   * At 2:1, we’re “interrupting”.
   */
  interrupt?: boolean | undefined

  /**
   * The relevant parsing context.
   */
  parser: ParseContext

  /**
   * The previous code.
   */
  previous: Code

  /**
   * Define a skip
   *
   * As containers (block quotes, lists), “nibble” a prefix from the margins,
   * where a line starts after that prefix is defined here.
   * When the tokenizers moves after consuming a line ending corresponding to
   * the line number in the given point, the tokenizer shifts past the prefix
   * based on the column in the shifted point.
   *
   * @param point
   *   Skip.
   * @returns
   *   Nothing.
   */
  defineSkip(point: Point): undefined

  /**
   * Get the current place.
   *
   * @returns
   *   Current point.
   */
  now(): Point

  /**
   * Get the source text that spans a token (or location).
   *
   * @param token
   *   Start/end in stream.
   * @param expandTabs
   *   Whether to expand tabs.
   * @returns
   *   Serialized chunks.
   */
  sliceSerialize(
    token: Pick<Token, 'end' | 'start'>,
    expandTabs?: boolean | undefined
  ): string

  /**
   * Get the chunks that span a token (or location).
   *
   * @param token
   *   Start/end in stream.
   * @returns
   *   List of chunks.
   */
  sliceStream(token: Pick<Token, 'end' | 'start'>): Array<Chunk>

  /**
   * Write a slice of chunks.
   *
   * The eof code (`null`) can be used to signal the end of the stream.
   *
   * @param slice
   *   Chunks.
   * @returns
   *   Events.
   */
  write(slice: Array<Chunk>): Array<Event>
}

/**
 * Encodings supported by `TextEncoder`.
 *
 * Arbitrary encodings can be supported depending on how the engine is built.
 * So any string *could* be valid.
 * But you probably want `utf-8`.
 */
export type Encoding =
  // Encodings supported in Node by default or when built with the small-icu option.
  // Does not include aliases.
  | 'utf-8' // Always supported in Node.
  | 'utf-16le' // Always supported in Node.
  | 'utf-16be' // Not supported when ICU is disabled.
  // Everything else (depends on browser, or full ICU data).
  | (string & {})

/**
 * Contents of the file.
 *
 * Can either be text, or a `Uint8Array` like structure.
 */
export type Value = Uint8Array | string

/**
 * A syntax extension changes how markdown is tokenized.
 *
 * See: <https://github.com/micromark/micromark#syntaxextension>
 */
export interface Extension {
  attentionMarkers?: {null?: Array<Code> | undefined} | undefined
  contentInitial?: ConstructRecord | undefined
  disable?: {null?: Array<string> | undefined} | undefined
  document?: ConstructRecord | undefined
  flowInitial?: ConstructRecord | undefined
  flow?: ConstructRecord | undefined
  insideSpan?:
    {null?: Array<Pick<Construct, 'resolveAll'>> | undefined} | undefined
  string?: ConstructRecord | undefined
  text?: ConstructRecord | undefined
}

/**
 * A filtered, combined, extension.
 */
export type NormalizedExtension = {
  [Key in keyof Extension]: Exclude<Extension[Key], undefined>
}

/**
 * A full, filtereed, normalized, extension.
 */
export type FullNormalizedExtension = {
  [Key in keyof Extension]-?: Exclude<Extension[Key], undefined>
}

/**
 * Create a context.
 *
 * @param from
 *   Where to create from.
 * @returns
 *   Context.
 */
export type Create = (
  from?: Omit<Point, '_bufferIndex' | '_index'> | undefined
) => TokenizeContext

/**
 * Config defining how to parse.
 */
export interface ParseOptions {
  /**
   * Array of syntax extensions (default: `[]`).
   */
  extensions?: Array<Extension> | null | undefined
}

/**
 * A context object that helps w/ parsing markdown.
 */
export interface ParseContext {
  /**
   * All constructs.
   */
  constructs: FullNormalizedExtension

  /**
   * List of defined identifiers.
   */
  defined: Array<string>

  /**
   * Map of line numbers to whether they are lazy (as opposed to the line before
   * them).
   * Take for example:
   *
   * ```markdown
   * > a
   * b
   * ```
   *
   * L1 here is not lazy, L2 is.
   */
  lazy: Record<number, boolean>

  /**
   * Create a content tokenizer.
   */
  content: Create

  /**
   * Create a document tokenizer.
   */
  document: Create

  /**
   * Create a flow tokenizer.
   */
  flow: Create

  /**
   * Create a string tokenizer.
   */
  string: Create

  /**
   * Create a text tokenizer.
   */
  text: Create
}

/**
 * HTML compiler context.
 */
export interface CompileContext {
  /**
   * Configuration passed by the user.
   */
  options: CompileOptions

  /**
   * Capture some of the output data.
   *
   * @returns
   *   Nothing.
   */
  buffer(): undefined

  /**
   * Make a value safe for injection in HTML (except w/ `ignoreEncode`).
   *
   * @param value
   *   Raw value.
   * @returns
   *   Safe value.
   */
  encode(value: string): string

  /**
   * Get data from the key-value store.
   *
   * @param key
   *   Key.
   * @returns
   *   Value at `key` in compile data.
   */
  getData<Key extends keyof CompileData>(key: Key): CompileData[Key]

  /**
   * Output an extra line ending if the previous value wasn’t EOF/EOL.
   *
   * @returns
   *   Nothing.
   */
  lineEndingIfNeeded(): undefined

  /**
   * Output raw data.
   *
   * @param value
   *   Raw value.
   * @returns
   *   Nothing.
   */
  raw(value: string): undefined

  /**
   * Stop capturing and access the output data.
   *
   * @returns
   *   Captured data.
   */
  resume(): string

  /**
   * Set data into the key-value store.
   *
   * @param key
   *   Key.
   * @param value
   *   Value.
   * @returns
   *   Nothing.
   */
  setData<Key extends keyof CompileData>(
    key: Key,
    value?: CompileData[Key]
  ): undefined

  /**
   * Get the string value of a token.
   *
   * @param token
   *   Start/end in stream.
   * @param expandTabs
   *   Whether to expand tabs.
   * @returns
   *   Serialized chunks.
   */
  sliceSerialize(
    token: Pick<Token, 'end' | 'start'>,
    expandTabs?: boolean | undefined
  ): string

  /**
   * Output (parts of) HTML tags.
   *
   * @param value
   *   Raw value.
   * @returns
   *   Nothing.
   */
  tag(value: string): undefined
}

/**
 * Serialize micromark events as HTML.
 */
export type Compile = (events: Array<Event>) => string

/**
 * Handle one token.
 *
 * @param token
 *   Token.
 * @returns
 *   Nothing.
 */
export type Handle = (this: CompileContext, token: Token) => undefined

/**
 * Handle the whole document.
 *
 * @returns
 *   Nothing.
 */
export type DocumentHandle = (
  this: Omit<CompileContext, 'sliceSerialize'>
) => undefined

/**
 * Token types mapping to handles.
 */
export interface Handles extends Partial<Record<TokenType, Handle>> {
  /**
   * Document handle.
   */
  null?: DocumentHandle
}

/**
 * Normalized extenion.
 */
export interface HtmlExtension {
  enter?: Handles | undefined
  exit?: Handles | undefined
}

/**
 * An HTML extension changes how markdown tokens are serialized.
 */
export type NormalizedHtmlExtension = {
  [Key in keyof HtmlExtension]-?: Exclude<HtmlExtension[Key], undefined>
}

/**
 * Definition.
 */
export interface Definition {
  /**
   * Destination.
   */
  destination?: string | undefined
  /**
   * Title.
   */
  title?: string | undefined
}

/**
 * State tracked to compile events as HTML.
 */
export interface CompileData {
  /**
   * Whether the first list item is expected, used by lists.
   */
  expectFirstItem?: boolean | undefined

  /**
   * Current character reference kind.
   */
  characterReferenceType?: string | undefined

  /**
   * Collected definitions.
   */
  definitions: Record<string, Definition>

  /**
   * Whether we’re in fenced code, used by code (fenced).
   */
  fencedCodeInside?: boolean | undefined

  /**
   * Number of fences that were seen, used by code (fenced).
   */
  fencesCount?: number | undefined

  /**
   * Whether we’ve seen code data, used by code (fenced, indented).
   */
  flowCodeSeenData?: boolean | undefined

  /**
   * Current heading rank, used by heading (atx, setext).
   */
  headingRank?: number | undefined

  /**
   * Ignore encoding unsafe characters, used for example for URLs which are
   * first percent encoded, or by HTML when supporting it.
   */
  ignoreEncode?: boolean | undefined

  /**
   * Whether we’re in code data, used by code (text).
   */
  inCodeText?: boolean | undefined

  /**
   * Whether the last emitted value was a tag.
   */
  lastWasTag?: boolean | undefined

  /**
   * Whether to slurp all future line endings (has to be unset manually).
   */
  slurpAllLineEndings?: boolean | undefined

  /**
   * Whether to slurp the next line ending (resets itself on the next line
   * ending).
   */
  slurpOneLineEnding?: boolean | undefined

  /**
   * Stack of containers, whether they’re tight or not.
   */
  tightStack: Array<boolean>
}

/**
 * Type of line ending in markdown.
 */
export type LineEnding = '\r' | '\n' | '\r\n'

/**
 * Compile options.
 */
export interface CompileOptions {
  /**
   * Whether to allow (dangerous) HTML (`boolean`, default: `false`).
   *
   * The default is `false`, which still parses the HTML according to
   * `CommonMark` but shows the HTML as text instead of as elements.
   *
   * Pass `true` for trusted content to get actual HTML elements.
   */
  allowDangerousHtml?: boolean | null | undefined

  /**
   * Whether to allow dangerous protocols in links and images (`boolean`,
   * default: `false`).
   *
   * The default is `false`, which drops URLs in links and images that use
   * dangerous protocols.
   *
   * Pass `true` for trusted content to support all protocols.
   *
   * URLs that have no protocol (which means it’s relative to the current page,
   * such as `./some/page.html`) and URLs that have a safe protocol (for
   * images: `http`, `https`; for links: `http`, `https`, `irc`, `ircs`,
   * `mailto`, `xmpp`), are safe.
   * All other URLs are dangerous and dropped.
   */
  allowDangerousProtocol?: boolean | null | undefined

  /**
   * Default line ending to use when compiling to HTML, for line endings not in
   * `value`.
   *
   * Generally, `micromark` copies line endings (`\r`, `\n`, `\r\n`) in the
   * markdown document over to the compiled HTML.
   * In some cases, such as `> a`, CommonMark requires that extra line endings
   * are added: `<blockquote>\n<p>a</p>\n</blockquote>`.
   *
   * To create that line ending, the document is checked for the first line
   * ending that is used.
   * If there is no line ending, `defaultLineEnding` is used.
   * If that isn’t configured, `\n` is used.
   */
  defaultLineEnding?: LineEnding | null | undefined

  /**
   * Array of HTML extensions (default: `[]`).
   */
  htmlExtensions?: Array<HtmlExtension> | null | undefined
}

/**
 * Configuration.
 */
export type Options = CompileOptions & ParseOptions

/**
 * Enum of allowed token types.
 */
export type TokenType = keyof TokenTypeMap

// Note: when changing the next interface, you likely also have to change
// `micromark-util-symbol`.
/**
 * Map of allowed token types.
 */
export interface TokenTypeMap {
  // Note: these are compiled away.
  attentionSequence: 'attentionSequence' // To do: remove.
  space: 'space' // To do: remove.

  data: 'data'
  whitespace: 'whitespace'
  lineEnding: 'lineEnding'
  lineEndingBlank: 'lineEndingBlank'
  linePrefix: 'linePrefix'
  lineSuffix: 'lineSuffix'
  atxHeading: 'atxHeading'
  atxHeadingSequence: 'atxHeadingSequence'
  atxHeadingText: 'atxHeadingText'
  autolink: 'autolink'
  autolinkEmail: 'autolinkEmail'
  autolinkMarker: 'autolinkMarker'
  autolinkProtocol: 'autolinkProtocol'
  characterEscape: 'characterEscape'
  characterEscapeValue: 'characterEscapeValue'
  characterReference: 'characterReference'
  characterReferenceMarker: 'characterReferenceMarker'
  characterReferenceMarkerNumeric: 'characterReferenceMarkerNumeric'
  characterReferenceMarkerHexadecimal: 'characterReferenceMarkerHexadecimal'
  characterReferenceValue: 'characterReferenceValue'
  codeFenced: 'codeFenced'
  codeFencedFence: 'codeFencedFence'
  codeFencedFenceSequence: 'codeFencedFenceSequence'
  codeFencedFenceInfo: 'codeFencedFenceInfo'
  codeFencedFenceMeta: 'codeFencedFenceMeta'
  codeFlowValue: 'codeFlowValue'
  codeIndented: 'codeIndented'
  codeText: 'codeText'
  codeTextData: 'codeTextData'
  codeTextPadding: 'codeTextPadding'
  codeTextSequence: 'codeTextSequence'
  content: 'content'
  definition: 'definition'
  definitionDestination: 'definitionDestination'
  definitionDestinationLiteral: 'definitionDestinationLiteral'
  definitionDestinationLiteralMarker: 'definitionDestinationLiteralMarker'
  definitionDestinationRaw: 'definitionDestinationRaw'
  definitionDestinationString: 'definitionDestinationString'
  definitionLabel: 'definitionLabel'
  definitionLabelMarker: 'definitionLabelMarker'
  definitionLabelString: 'definitionLabelString'
  definitionMarker: 'definitionMarker'
  definitionTitle: 'definitionTitle'
  definitionTitleMarker: 'definitionTitleMarker'
  definitionTitleString: 'definitionTitleString'
  emphasis: 'emphasis'
  emphasisSequence: 'emphasisSequence'
  emphasisText: 'emphasisText'
  escapeMarker: 'escapeMarker'
  hardBreakEscape: 'hardBreakEscape'
  hardBreakTrailing: 'hardBreakTrailing'
  htmlFlow: 'htmlFlow'
  htmlFlowData: 'htmlFlowData'
  htmlText: 'htmlText'
  htmlTextData: 'htmlTextData'
  image: 'image'
  label: 'label'
  labelText: 'labelText'
  labelLink: 'labelLink'
  labelImage: 'labelImage'
  labelMarker: 'labelMarker'
  labelImageMarker: 'labelImageMarker'
  labelEnd: 'labelEnd'
  link: 'link'
  paragraph: 'paragraph'
  reference: 'reference'
  referenceMarker: 'referenceMarker'
  referenceString: 'referenceString'
  resource: 'resource'
  resourceDestination: 'resourceDestination'
  resourceDestinationLiteral: 'resourceDestinationLiteral'
  resourceDestinationLiteralMarker: 'resourceDestinationLiteralMarker'
  resourceDestinationRaw: 'resourceDestinationRaw'
  resourceDestinationString: 'resourceDestinationString'
  resourceMarker: 'resourceMarker'
  resourceTitle: 'resourceTitle'
  resourceTitleMarker: 'resourceTitleMarker'
  resourceTitleString: 'resourceTitleString'
  setextHeading: 'setextHeading'
  setextHeadingText: 'setextHeadingText'
  setextHeadingLine: 'setextHeadingLine'
  setextHeadingLineSequence: 'setextHeadingLineSequence'
  strong: 'strong'
  strongSequence: 'strongSequence'
  strongText: 'strongText'
  thematicBreak: 'thematicBreak'
  thematicBreakSequence: 'thematicBreakSequence'
  blockQuote: 'blockQuote'
  blockQuotePrefix: 'blockQuotePrefix'
  blockQuoteMarker: 'blockQuoteMarker'
  blockQuotePrefixWhitespace: 'blockQuotePrefixWhitespace'
  listOrdered: 'listOrdered'
  listUnordered: 'listUnordered'
  listItemIndent: 'listItemIndent'
  listItemMarker: 'listItemMarker'
  listItemPrefix: 'listItemPrefix'
  listItemPrefixWhitespace: 'listItemPrefixWhitespace'
  listItemValue: 'listItemValue'
  chunkDocument: 'chunkDocument'
  chunkContent: 'chunkContent'
  chunkFlow: 'chunkFlow'
  chunkText: 'chunkText'
  chunkString: 'chunkString'
}
}

declare module 'mdast' {
import type { Data as UnistData, Literal as UnistLiteral, Node as UnistNode, Parent as UnistParent } from "unist";

// ## Enumeration

/**
 * How phrasing content is aligned
 * ({@link https://drafts.csswg.org/css-text/ | [CSSTEXT]}).
 *
 * * `'left'`: See the
 *   {@link https://drafts.csswg.org/css-text/#valdef-text-align-left | left}
 *   value of the `text-align` CSS property
 * * `'right'`: See the
 *   {@link https://drafts.csswg.org/css-text/#valdef-text-align-right | right}
 *   value of the `text-align` CSS property
 * * `'center'`: See the
 *   {@link https://drafts.csswg.org/css-text/#valdef-text-align-center | center}
 *   value of the `text-align` CSS property
 * * `null`: phrasing content is aligned as defined by the host environment
 *
 * Used in GFM tables.
 */
export type AlignType = "center" | "left" | "right" | null;

/**
 * Explicitness of a reference.
 *
 * `'shortcut'`: the reference is implicit, its identifier inferred from its
 *   content
 * `'collapsed'`: the reference is explicit, its identifier inferred from its
 *   content
 * `'full'`: the reference is explicit, its identifier explicitly set
 */
export type ReferenceType = "shortcut" | "collapsed" | "full";

// ## Mixin

/**
 * Node with a fallback.
 */
export interface Alternative {
    /**
     * Equivalent content for environments that cannot represent the node as
     * intended.
     */
    alt?: string | null | undefined;
}

/**
 * Internal relation from one node to another.
 *
 * Whether the value of `identifier` is expected to be a unique identifier or
 * not depends on the type of node including the Association.
 * An example of this is that they should be unique on {@link Definition},
 * whereas multiple {@link LinkReference}s can be non-unique to be associated
 * with one definition.
 */
export interface Association {
    /**
     * Relation of association.
     *
     * `identifier` is a source value: character escapes and character
     * references are not parsed.
     *
     * It can match another node.
     *
     * Its value must be normalized.
     * To normalize a value, collapse markdown whitespace (`[\t\n\r ]+`) to a space,
     * trim the optional initial and/or final space, and perform Unicode-aware
     * case-folding.
     */
    identifier: string;

    /**
     * Relation of association, in parsed form.
     *
     * `label` is a `string` value: it works just like `title` on {@link Link}
     * or a `lang` on {@link Code}: character escapes and character references
     * are parsed.
     *
     * It can match another node.
     */
    label?: string | null | undefined;
}

/**
 * Marker that is associated to another node.
 */
export interface Reference extends Association {
    /**
     * Explicitness of the reference.
     */
    referenceType: ReferenceType;
}

/**
 * Reference to resource.
 */
export interface Resource {
    /**
     * URL to the referenced resource.
     */
    url: string;
    /**
     * Advisory information for the resource, such as would be appropriate for
     * a tooltip.
     */
    title?: string | null | undefined;
}

// ## Interfaces

/**
 * Info associated with mdast nodes by the ecosystem.
 *
 * This space is guaranteed to never be specified by unist or mdast.
 * But you can use it in utilities and plugins to store data.
 *
 * This type can be augmented to register custom data.
 * For example:
 *
 * ```ts
 * declare module 'mdast' {
 *   interface Data {
 *     // `someNode.data.myId` is typed as `number | undefined`
 *     myId?: number | undefined
 *   }
 * }
 * ```
 */
export interface Data extends UnistData {}

// ## Content maps

/**
 * Union of registered mdast nodes that can occur where block content is
 * expected.
 *
 * To register custom mdast nodes, add them to {@link BlockContentMap}.
 * They will be automatically added here.
 */
export type BlockContent = BlockContentMap[keyof BlockContentMap];

/**
 * Registry of all mdast nodes that can occur where {@link BlockContent} is
 * expected.
 *
 * This interface can be augmented to register custom node types:
 *
 * ```ts
 * declare module 'mdast' {
 *   interface BlockContentMap {
 *     // Allow using MDX ESM nodes defined by `remark-mdx`.
 *     mdxjsEsm: MdxjsEsm;
 *   }
 * }
 * ```
 *
 * For a union of all block content, see {@link RootContent}.
 */
export interface BlockContentMap {
    blockquote: Blockquote;
    code: Code;
    heading: Heading;
    html: Html;
    list: List;
    paragraph: Paragraph;
    table: Table;
    thematicBreak: ThematicBreak;
}

/**
 * Union of registered mdast nodes that can occur where definition content is
 * expected.
 *
 * To register custom mdast nodes, add them to {@link DefinitionContentMap}.
 * They will be automatically added here.
 */
export type DefinitionContent = DefinitionContentMap[keyof DefinitionContentMap];

/**
 * Registry of all mdast nodes that can occur where {@link DefinitionContent}
 * is expected.
 *
 * This interface can be augmented to register custom node types:
 *
 * ```ts
 * declare module 'mdast' {
 *   interface DefinitionContentMap {
 *     custom: Custom;
 *   }
 * }
 * ```
 *
 * For a union of all definition content, see {@link RootContent}.
 */
export interface DefinitionContentMap {
    definition: Definition;
    footnoteDefinition: FootnoteDefinition;
}

/**
 * Union of registered mdast nodes that can occur where frontmatter content is
 * expected.
 *
 * To register custom mdast nodes, add them to {@link FrontmatterContentMap}.
 * They will be automatically added here.
 */
export type FrontmatterContent = FrontmatterContentMap[keyof FrontmatterContentMap];

/**
 * Registry of all mdast nodes that can occur where {@link FrontmatterContent}
 * is expected.
 *
 * This interface can be augmented to register custom node types:
 *
 * ```ts
 * declare module 'mdast' {
 *   interface FrontmatterContentMap {
 *     // Allow using toml nodes defined by `remark-frontmatter`.
 *     toml: TOML;
 *   }
 * }
 * ```
 *
 * For a union of all frontmatter content, see {@link RootContent}.
 */
export interface FrontmatterContentMap {
    yaml: Yaml;
}

/**
 * Union of registered mdast nodes that can occur where list content is
 * expected.
 *
 * To register custom mdast nodes, add them to {@link ListContentMap}.
 * They will be automatically added here.
 */
export type ListContent = ListContentMap[keyof ListContentMap];

/**
 * Registry of all mdast nodes that can occur where {@link ListContent}
 * is expected.
 *
 * This interface can be augmented to register custom node types:
 *
 * ```ts
 * declare module 'mdast' {
 *   interface ListContentMap {
 *     custom: Custom;
 *   }
 * }
 * ```
 *
 * For a union of all list content, see {@link RootContent}.
 */
export interface ListContentMap {
    listItem: ListItem;
}

/**
 * Union of registered mdast nodes that can occur where phrasing content is
 * expected.
 *
 * To register custom mdast nodes, add them to {@link PhrasingContentMap}.
 * They will be automatically added here.
 */
export type PhrasingContent = PhrasingContentMap[keyof PhrasingContentMap];

/**
 * Registry of all mdast nodes that can occur where {@link PhrasingContent}
 * is expected.
 *
 * This interface can be augmented to register custom node types:
 *
 * ```ts
 * declare module 'mdast' {
 *   interface PhrasingContentMap {
 *     // Allow using MDX JSX (text) nodes defined by `remark-mdx`.
 *     mdxJsxTextElement: MDXJSXTextElement;
 *   }
 * }
 * ```
 *
 * For a union of all phrasing content, see {@link RootContent}.
 */
export interface PhrasingContentMap {
    break: Break;
    delete: Delete;
    emphasis: Emphasis;
    footnoteReference: FootnoteReference;
    html: Html;
    image: Image;
    imageReference: ImageReference;
    inlineCode: InlineCode;
    link: Link;
    linkReference: LinkReference;
    strong: Strong;
    text: Text;
}

/**
 * Union of registered mdast nodes that can occur in {@link Root}.
 *
 * To register custom mdast nodes, add them to {@link RootContentMap}.
 * They will be automatically added here.
 */
export type RootContent = RootContentMap[keyof RootContentMap];

/**
 * Registry of all mdast nodes that can occur as children of {@link Root}.
 *
 * > **Note**: {@link Root} does not need to be an entire document.
 * > it can also be a fragment.
 *
 * This interface can be augmented to register custom node types:
 *
 * ```ts
 * declare module 'mdast' {
 *   interface RootContentMap {
 *     // Allow using toml nodes defined by `remark-frontmatter`.
 *     toml: TOML;
 *   }
 * }
 * ```
 *
 * For a union of all {@link Root} children, see {@link RootContent}.
 */
export interface RootContentMap {
    blockquote: Blockquote;
    break: Break;
    code: Code;
    definition: Definition;
    delete: Delete;
    emphasis: Emphasis;
    footnoteDefinition: FootnoteDefinition;
    footnoteReference: FootnoteReference;
    heading: Heading;
    html: Html;
    image: Image;
    imageReference: ImageReference;
    inlineCode: InlineCode;
    link: Link;
    linkReference: LinkReference;
    list: List;
    listItem: ListItem;
    paragraph: Paragraph;
    strong: Strong;
    table: Table;
    tableCell: TableCell;
    tableRow: TableRow;
    text: Text;
    thematicBreak: ThematicBreak;
    yaml: Yaml;
}

/**
 * Union of registered mdast nodes that can occur where row content is
 * expected.
 *
 * To register custom mdast nodes, add them to {@link RowContentMap}.
 * They will be automatically added here.
 */
export type RowContent = RowContentMap[keyof RowContentMap];

/**
 * Registry of all mdast nodes that can occur where {@link RowContent}
 * is expected.
 *
 * This interface can be augmented to register custom node types:
 *
 * ```ts
 * declare module 'mdast' {
 *   interface RowContentMap {
 *     custom: Custom;
 *   }
 * }
 * ```
 *
 * For a union of all row content, see {@link RootContent}.
 */
export interface RowContentMap {
    tableCell: TableCell;
}

/**
 * Union of registered mdast nodes that can occur where table content is
 * expected.
 *
 * To register custom mdast nodes, add them to {@link TableContentMap}.
 * They will be automatically added here.
 */
export type TableContent = TableContentMap[keyof TableContentMap];

/**
 * Registry of all mdast nodes that can occur where {@link TableContent}
 * is expected.
 *
 * This interface can be augmented to register custom node types:
 *
 * ```ts
 * declare module 'mdast' {
 *   interface TableContentMap {
 *     custom: Custom;
 *   }
 * }
 * ```
 *
 * For a union of all table content, see {@link RootContent}.
 */
export interface TableContentMap {
    tableRow: TableRow;
}

// ### Special content types

/**
 * Union of registered mdast nodes that can occur in {@link Root}.
 *
 * @deprecated Use {@link RootContent} instead.
 */
export type Content = RootContent;

/**
 * Union of registered mdast literals.
 *
 * To register custom mdast nodes, add them to {@link RootContentMap} and other
 * places where relevant.
 * They will be automatically added here.
 */
export type Literals = Extract<Nodes, UnistLiteral>;

/**
 * Union of registered mdast nodes.
 *
 * To register custom mdast nodes, add them to {@link RootContentMap} and other
 * places where relevant.
 * They will be automatically added here.
 */
export type Nodes = Root | RootContent;

/**
 * Union of registered mdast parents.
 *
 * To register custom mdast nodes, add them to {@link RootContentMap} and other
 * places where relevant.
 * They will be automatically added here.
 */
export type Parents = Extract<Nodes, UnistParent>;

/**
 * Union of registered mdast nodes that can occur at the top of the document.
 *
 * To register custom mdast nodes, add them to {@link BlockContent},
 * {@link FrontmatterContent}, or {@link DefinitionContent}.
 * They will be automatically added here.
 */
export type TopLevelContent = BlockContent | FrontmatterContent | DefinitionContent;

// ## Abstract nodes

/**
 * Abstract mdast node that contains the smallest possible value.
 *
 * This interface is supposed to be extended if you make custom mdast nodes.
 *
 * For a union of all registered mdast literals, see {@link Literals}.
 */
export interface Literal extends Node {
    /**
     * Plain-text value.
     */
    value: string;
}

/**
 * Abstract mdast node.
 *
 * This interface is supposed to be extended.
 * If you can use {@link Literal} or {@link Parent}, you should.
 * But for example in markdown, a thematic break (`***`) is neither literal nor
 * parent, but still a node.
 *
 * To register custom mdast nodes, add them to {@link RootContentMap} and other
 * places where relevant (such as {@link ElementContentMap}).
 *
 * For a union of all registered mdast nodes, see {@link Nodes}.
 */
export interface Node extends UnistNode {
    /**
     * Info from the ecosystem.
     */
    data?: Data | undefined;
}

/**
 * Abstract mdast node that contains other mdast nodes (*children*).
 *
 * This interface is supposed to be extended if you make custom mdast nodes.
 *
 * For a union of all registered mdast parents, see {@link Parents}.
 */
export interface Parent extends Node {
    /**
     * List of children.
     */
    children: RootContent[];
}

// ## Concrete nodes

/**
 * Markdown block quote.
 */
export interface Blockquote extends Parent {
    /**
     * Node type of mdast block quote.
     */
    type: "blockquote";
    /**
     * Children of block quote.
     */
    children: Array<BlockContent | DefinitionContent>;
    /**
     * Data associated with the mdast block quote.
     */
    data?: BlockquoteData | undefined;
}

/**
 * Info associated with mdast block quote nodes by the ecosystem.
 */
export interface BlockquoteData extends Data {}

/**
 * Markdown break.
 */
export interface Break extends Node {
    /**
     * Node type of mdast break.
     */
    type: "break";
    /**
     * Data associated with the mdast break.
     */
    data?: BreakData | undefined;
}

/**
 * Info associated with mdast break nodes by the ecosystem.
 */
export interface BreakData extends Data {}

/**
 * Markdown code (flow) (block).
 */
export interface Code extends Literal {
    /**
     * Node type of mdast code (flow).
     */
    type: "code";
    /**
     * Language of computer code being marked up.
     */
    lang?: string | null | undefined;
    /**
     * Custom information relating to the node.
     *
     * If the lang field is present, a meta field can be present.
     */
    meta?: string | null | undefined;
    /**
     * Data associated with the mdast code (flow).
     */
    data?: CodeData | undefined;
}

/**
 * Info associated with mdast code (flow) (block) nodes by the ecosystem.
 */
export interface CodeData extends Data {}

/**
 * Markdown definition.
 */
export interface Definition extends Node, Association, Resource {
    /**
     * Node type of mdast definition.
     */
    type: "definition";
    /**
     * Data associated with the mdast definition.
     */
    data?: DefinitionData | undefined;
}

/**
 * Info associated with mdast definition nodes by the ecosystem.
 */
export interface DefinitionData extends Data {}

/**
 * Markdown GFM delete (strikethrough).
 */
export interface Delete extends Parent {
    /**
     * Node type of mdast GFM delete.
     */
    type: "delete";
    /**
     * Children of GFM delete.
     */
    children: PhrasingContent[];
    /**
     * Data associated with the mdast GFM delete.
     */
    data?: DeleteData | undefined;
}

/**
 * Info associated with mdast GFM delete nodes by the ecosystem.
 */
export interface DeleteData extends Data {}

/**
 * Markdown emphasis.
 */
export interface Emphasis extends Parent {
    /**
     * Node type of mdast emphasis.
     */
    type: "emphasis";
    /**
     * Children of emphasis.
     */
    children: PhrasingContent[];
    /**
     * Data associated with the mdast emphasis.
     */
    data?: EmphasisData | undefined;
}

/**
 * Info associated with mdast emphasis nodes by the ecosystem.
 */
export interface EmphasisData extends Data {}

/**
 * Markdown GFM footnote definition.
 */
export interface FootnoteDefinition extends Parent, Association {
    /**
     * Node type of mdast GFM footnote definition.
     */
    type: "footnoteDefinition";
    /**
     * Children of GFM footnote definition.
     */
    children: Array<BlockContent | DefinitionContent>;
    /**
     * Data associated with the mdast GFM footnote definition.
     */
    data?: FootnoteDefinitionData | undefined;
}

/**
 * Info associated with mdast GFM footnote definition nodes by the ecosystem.
 */
export interface FootnoteDefinitionData extends Data {}

/**
 * Markdown GFM footnote reference.
 */
export interface FootnoteReference extends Association, Node {
    /**
     * Node type of mdast GFM footnote reference.
     */
    type: "footnoteReference";
    /**
     * Data associated with the mdast GFM footnote reference.
     */
    data?: FootnoteReferenceData | undefined;
}

/**
 * Info associated with mdast GFM footnote reference nodes by the ecosystem.
 */
export interface FootnoteReferenceData extends Data {}

/**
 * Markdown heading.
 */
export interface Heading extends Parent {
    /**
     * Node type of mdast heading.
     */
    type: "heading";
    /**
     * Heading rank.
     *
     * A value of `1` is said to be the highest rank and `6` the lowest.
     */
    depth: 1 | 2 | 3 | 4 | 5 | 6;
    /**
     * Children of heading.
     */
    children: PhrasingContent[];
    /**
     * Data associated with the mdast heading.
     */
    data?: HeadingData | undefined;
}

/**
 * Info associated with mdast heading nodes by the ecosystem.
 */
export interface HeadingData extends Data {}

/**
 * Markdown HTML.
 */
export interface Html extends Literal {
    /**
     * Node type of mdast HTML.
     */
    type: "html";
    /**
     * Data associated with the mdast HTML.
     */
    data?: HtmlData | undefined;
}

/**
 * Info associated with mdast HTML nodes by the ecosystem.
 */
export interface HtmlData extends Data {}

/**
 * Old name of `Html` node.
 *
 * @deprecated
 *   Please use `Html` instead.
 */
export type HTML = Html;

/**
 * Markdown image.
 */
export interface Image extends Alternative, Node, Resource {
    /**
     * Node type of mdast image.
     */
    type: "image";
    /**
     * Data associated with the mdast image.
     */
    data?: ImageData | undefined;
}

/**
 * Info associated with mdast image nodes by the ecosystem.
 */
export interface ImageData extends Data {}

/**
 * Markdown image reference.
 */
export interface ImageReference extends Alternative, Node, Reference {
    /**
     * Node type of mdast image reference.
     */
    type: "imageReference";
    /**
     * Data associated with the mdast image reference.
     */
    data?: ImageReferenceData | undefined;
}

/**
 * Info associated with mdast image reference nodes by the ecosystem.
 */
export interface ImageReferenceData extends Data {}

/**
 * Markdown code (text) (inline).
 */
export interface InlineCode extends Literal {
    /**
     * Node type of mdast code (text).
     */
    type: "inlineCode";
    /**
     * Data associated with the mdast code (text).
     */
    data?: InlineCodeData | undefined;
}

/**
 * Info associated with mdast code (text) (inline) nodes by the ecosystem.
 */
export interface InlineCodeData extends Data {}

/**
 * Markdown link.
 */
export interface Link extends Parent, Resource {
    /**
     * Node type of mdast link.
     */
    type: "link";
    /**
     * Children of link.
     */
    children: PhrasingContent[];
    /**
     * Data associated with the mdast link.
     */
    data?: LinkData | undefined;
}

/**
 * Info associated with mdast link nodes by the ecosystem.
 */
export interface LinkData extends Data {}

/**
 * Markdown link reference.
 */
export interface LinkReference extends Parent, Reference {
    /**
     * Node type of mdast link reference.
     */
    type: "linkReference";
    /**
     * Children of link reference.
     */
    children: PhrasingContent[];
    /**
     * Data associated with the mdast link reference.
     */
    data?: LinkReferenceData | undefined;
}

/**
 * Info associated with mdast link reference nodes by the ecosystem.
 */
export interface LinkReferenceData extends Data {}

/**
 * Markdown list.
 */
export interface List extends Parent {
    /**
     * Node type of mdast list.
     */
    type: "list";
    /**
     * Whether the items have been intentionally ordered (when `true`), or that
     * the order of items is not important (when `false` or not present).
     */
    ordered?: boolean | null | undefined;
    /**
     * The starting number of the list, when the `ordered` field is `true`.
     */
    start?: number | null | undefined;
    /**
     * Whether one or more of the children are separated with a blank line from
     * its siblings (when `true`), or not (when `false` or not present).
     */
    spread?: boolean | null | undefined;
    /**
     * Children of list.
     */
    children: ListContent[];
    /**
     * Data associated with the mdast list.
     */
    data?: ListData | undefined;
}

/**
 * Info associated with mdast list nodes by the ecosystem.
 */
export interface ListData extends Data {}

/**
 * Markdown list item.
 */
export interface ListItem extends Parent {
    /**
     * Node type of mdast list item.
     */
    type: "listItem";
    /**
     * Whether the item is a tasklist item (when `boolean`).
     *
     * When `true`, the item is complete.
     * When `false`, the item is incomplete.
     */
    checked?: boolean | null | undefined;
    /**
     * Whether one or more of the children are separated with a blank line from
     * its siblings (when `true`), or not (when `false` or not present).
     */
    spread?: boolean | null | undefined;
    /**
     * Children of list item.
     */
    children: Array<BlockContent | DefinitionContent>;
    /**
     * Data associated with the mdast list item.
     */
    data?: ListItemData | undefined;
}

/**
 * Info associated with mdast list item nodes by the ecosystem.
 */
export interface ListItemData extends Data {}

/**
 * Markdown paragraph.
 */
export interface Paragraph extends Parent {
    /**
     * Node type of mdast paragraph.
     */
    type: "paragraph";
    /**
     * Children of paragraph.
     */
    children: PhrasingContent[];
    /**
     * Data associated with the mdast paragraph.
     */
    data?: ParagraphData | undefined;
}

/**
 * Info associated with mdast paragraph nodes by the ecosystem.
 */
export interface ParagraphData extends Data {}

/**
 * Document fragment or a whole document.
 *
 * Should be used as the root of a tree and must not be used as a child.
 */
export interface Root extends Parent {
    /**
     * Node type of mdast root.
     */
    type: "root";
    /**
     * Data associated with the mdast root.
     */
    data?: RootData | undefined;
}

/**
 * Info associated with mdast root nodes by the ecosystem.
 */
export interface RootData extends Data {}

/**
 * Markdown strong.
 */
export interface Strong extends Parent {
    /**
     * Node type of mdast strong.
     */
    type: "strong";
    /**
     * Children of strong.
     */
    children: PhrasingContent[];
    /**
     * Data associated with the mdast strong.
     */
    data?: StrongData | undefined;
}

/**
 * Info associated with mdast strong nodes by the ecosystem.
 */
export interface StrongData extends Data {}

/**
 * Markdown GFM table.
 */
export interface Table extends Parent {
    /**
     * Node type of mdast GFM table.
     */
    type: "table";
    /**
     * How cells in columns are aligned.
     */
    align?: AlignType[] | null | undefined;
    /**
     * Children of GFM table.
     */
    children: TableContent[];
    /**
     * Data associated with the mdast GFM table.
     */
    data?: TableData | undefined;
}

/**
 * Info associated with mdast GFM table nodes by the ecosystem.
 */
export interface TableData extends Data {}

/**
 * Markdown GFM table row.
 */
export interface TableRow extends Parent {
    /**
     * Node type of mdast GFM table row.
     */
    type: "tableRow";
    /**
     * Children of GFM table row.
     */
    children: RowContent[];
    /**
     * Data associated with the mdast GFM table row.
     */
    data?: TableRowData | undefined;
}

/**
 * Info associated with mdast GFM table row nodes by the ecosystem.
 */
export interface TableRowData extends Data {}

/**
 * Markdown GFM table cell.
 */
export interface TableCell extends Parent {
    /**
     * Node type of mdast GFM table cell.
     */
    type: "tableCell";
    /**
     * Children of GFM table cell.
     */
    children: PhrasingContent[];
    /**
     * Data associated with the mdast GFM table cell.
     */
    data?: TableCellData | undefined;
}

/**
 * Info associated with mdast GFM table cell nodes by the ecosystem.
 */
export interface TableCellData extends Data {}

/**
 * Markdown text.
 */
export interface Text extends Literal {
    /**
     * Node type of mdast text.
     */
    type: "text";
    /**
     * Data associated with the mdast text.
     */
    data?: TextData | undefined;
}

/**
 * Info associated with mdast text nodes by the ecosystem.
 */
export interface TextData extends Data {}

/**
 * Markdown thematic break (horizontal rule).
 */
export interface ThematicBreak extends Node {
    /**
     * Node type of mdast thematic break.
     */
    type: "thematicBreak";
    /**
     * Data associated with the mdast thematic break.
     */
    data?: ThematicBreakData | undefined;
}

/**
 * Info associated with mdast thematic break nodes by the ecosystem.
 */
export interface ThematicBreakData extends Data {}

/**
 * Markdown YAML.
 */
export interface Yaml extends Literal {
    /**
     * Node type of mdast YAML.
     */
    type: "yaml";
    /**
     * Data associated with the mdast YAML.
     */
    data?: YamlData | undefined;
}

/**
 * Info associated with mdast YAML nodes by the ecosystem.
 */
export interface YamlData extends Data {}

/**
 * Old name of `Yaml` node.
 *
 * @deprecated
 *   Please use `Yaml` instead.
 */
export type YAML = Yaml;
}

