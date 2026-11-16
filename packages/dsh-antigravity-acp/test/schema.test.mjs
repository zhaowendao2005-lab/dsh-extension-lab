import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolRegistry, ToolSchemaError } from '../src/bridge/schema.js';

const tool = (name, parameters = { type: 'object', properties: {}, additionalProperties: false }) => ({ name, description: 'Test tool', parameters });

function first(registry) { return registry.get(registry.toolNames[0]); }

test('name mapping is collision-free, deterministic, and retains original DSH identity', () => {
  const names = ['a.b', 'a/b', 'a_b', '工具', '__proto__', 'x'.repeat(512)];
  const registry = createToolRegistry(names.map((name) => tool(name)));
  assert.equal(new Set(registry.toolNames).size, names.length);
  assert.deepEqual(registry.toolNames, createToolRegistry(names.toReversed().map((name) => tool(name))).toolNames);
  for (const name of names) {
    const mapped = registry.mappedName(name);
    assert.match(mapped, /^[a-zA-Z0-9_-]{1,64}$/);
    assert.equal(registry.get(mapped).originalName, name);
  }
});

test('DSH schemas are copied exactly and callers cannot mutate the snapshot', () => {
  const schema = { type: 'object', properties: { value: { type: ['string', 'null'], default: 'unused' } }, required: ['value'], additionalProperties: false };
  const registry = createToolRegistry([tool('echo', schema)]);
  assert.equal(JSON.stringify(registry.list()[0].inputSchema), JSON.stringify(schema));
  schema.required.length = 0;
  registry.list()[0].inputSchema.properties.value.type = 'number';
  assert.equal(first(registry).validate({}), false);
  const args = { value: null };
  assert.equal(first(registry).validate(args), true);
  assert.deepEqual(args, { value: null });
});

test('required, additional properties, enum and numeric constraints are enforced without coercion', () => {
  const registry = createToolRegistry([tool('check', {
    type: 'object', properties: { count: { type: 'integer', minimum: 2, maximum: 4 }, tag: { enum: ['yes', 'no'] } },
    required: ['count', 'tag'], additionalProperties: false,
  })]);
  const { validate } = first(registry);
  assert.equal(validate({ count: 3, tag: 'yes' }), true);
  for (const args of [{ count: '3', tag: 'yes' }, { count: 1, tag: 'yes' }, { count: 5, tag: 'yes' }, { count: 3 }, { count: 3, tag: 'other' }, { count: 3, tag: 'yes', extra: true }]) assert.equal(validate(args), false);
});

test('local draft7 references and unions retain their constraints', () => {
  const parameters = {
    type: 'object', definitions: { id: { oneOf: [{ type: 'integer', minimum: 1 }, { type: 'string', pattern: '^id-' }] } },
    properties: { id: { $ref: '#/definitions/id' } }, required: ['id'], additionalProperties: false,
  };
  const { validate } = first(createToolRegistry([tool('refs', parameters)]));
  assert.equal(validate({ id: 2 }), true);
  assert.equal(validate({ id: 'id-ok' }), true);
  assert.equal(validate({ id: 0 }), false);
  assert.equal(validate({ id: 'bad' }), false);
});

test('2020-12 $defs are supported without changing the declaration', () => {
  const parameters = {
    $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object',
    $defs: { value: { type: 'string', minLength: 2 } }, properties: { value: { $ref: '#/$defs/value' } }, required: ['value'], additionalProperties: false,
  };
  const registry = createToolRegistry([tool('modern', parameters)]);
  assert.equal(JSON.stringify(registry.list()[0].inputSchema), JSON.stringify(parameters));
  assert.equal(first(registry).validate({ value: 'yes' }), true);
  assert.equal(first(registry).validate({ value: 'x' }), false);
});

test('literal property names and examples containing $ref do not become schema references', () => {
  const parameters = { type: 'object', properties: { $ref: { type: 'string' } }, examples: [{ $ref: 'https://example.invalid/not-a-schema' }] };
  assert.doesNotThrow(() => createToolRegistry([tool('literal', parameters)]));
});

test('remote, unresolved, anchored, asynchronous, unknown and foreign-dialect schemas fail closed', () => {
  const bad = [
    { properties: { x: { $ref: 'https://example.invalid/schema.json' } } },
    { properties: { x: { $ref: 'file:///etc/passwd' } } },
    { properties: { x: { $ref: '#missing-anchor' } } },
    { properties: { x: { $ref: '#/$defs/missing' } } },
    { $id: 'https://example.invalid/schema' }, { $async: true }, { unknownConstraint: 1 },
    { properties: { x: { type: 'string', format: 'unknown-format' } } },
    { $schema: 'http://json-schema.org/draft-04/schema#' },
    { properties: { x: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'string' } } },
  ];
  for (const constraints of bad) assert.throws(() => createToolRegistry([tool('bad', { type: 'object', ...constraints })]), ToolSchemaError);
});

test('missing, empty, nonobject roots, duplicates, hidden metadata and non-JSON schemas reject', () => {
  for (const schema of [undefined, {}, true, { type: 'array' }, { type: ['object', 'null'] }, { type: 'object', properties: { x: undefined } }, { type: 'object', minimum: NaN }]) {
    assert.throws(() => createToolRegistry([{ name: 'invalid', description: 'Invalid', parameters: schema }]), ToolSchemaError);
  }
  assert.throws(() => createToolRegistry([{ name: 'invalid', description: 'Invalid', parameters: { type: 'object', examples: Array(1) } }]), ToolSchemaError);
  const withExtra = [];
  withExtra.extra = 'not JSON';
  assert.throws(() => createToolRegistry([{ name: 'invalid', description: 'Invalid', parameters: { type: 'object', examples: withExtra } }]), ToolSchemaError);
  assert.throws(() => createToolRegistry([tool('same'), tool('same')]), ToolSchemaError);
  assert.throws(() => createToolRegistry([{ ...tool('hidden'), hidden: true }]), ToolSchemaError);
  assert.throws(() => createToolRegistry([{ ...tool('hidden'), hidden: false }]), ToolSchemaError);
  assert.deepEqual(createToolRegistry([]).toolNames, []);
});

test('validator-special schema map keys reject rather than silently lose constraints', () => {
  for (const key of ['properties', 'patternProperties', 'dependencies', 'dependentRequired', 'dependentSchemas', '$defs', 'definitions']) {
    const parameters = JSON.parse(`{"type":"object","${key}":{"__proto__":false}}`);
    assert.throws(() => createToolRegistry([tool('special', parameters)]), ToolSchemaError);
  }
});

test('schema size, nesting and tool count are bounded', () => {
  assert.throws(() => createToolRegistry([tool('large', { type: 'object', description: 'x'.repeat(256 * 1024) })]), ToolSchemaError);
  assert.throws(() => createToolRegistry(Array.from({ length: 513 }, (_, i) => tool(String(i)))), ToolSchemaError);
  let nested = { type: 'object' };
  for (let i = 0; i < 85; i++) nested = { type: 'object', properties: { child: nested } };
  assert.throws(() => createToolRegistry([tool('deep', nested)]), ToolSchemaError);
});
