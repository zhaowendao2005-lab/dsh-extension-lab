import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';

const DRAFT7 = 'http://json-schema.org/draft-07/schema#';
const DRAFT2020 = 'https://json-schema.org/draft/2020-12/schema';
const MAX_SCHEMA_BYTES = 256 * 1024;
const MAX_TOTAL_SCHEMA_BYTES = 2 * 1024 * 1024;
const MAX_TOOLS = 512;

export class ToolSchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ToolSchemaError';
    this.code = 'UNSUPPORTED_TOOL_SCHEMA';
  }
}

// This is deliberately a JSON clone, not a JSON.stringify replacer: unsupported
// values must fail instead of silently disappearing from the declaration.
export function cloneJson(value, depth = 0, seen = new Set()) {
  if (depth > 80) throw new ToolSchemaError('JSON nesting exceeds the supported limit');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object') throw new ToolSchemaError('A non-JSON value is unsupported');
  if (seen.has(value)) throw new ToolSchemaError('Cyclic JSON is unsupported');
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
    throw new ToolSchemaError('Only plain JSON objects are supported');
  }
  seen.add(value);
  let copy;
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) throw new ToolSchemaError('Sparse arrays or extra array properties are unsupported');
    copy = Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new ToolSchemaError('Non-JSON array properties are unsupported');
      return cloneJson(descriptor.value, depth + 1, seen);
    });
  } else {
    copy = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new ToolSchemaError('Symbol keys are unsupported');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new ToolSchemaError('Non-JSON properties are unsupported');
      }
      Object.defineProperty(copy, key, {
        value: cloneJson(descriptor.value, depth + 1, seen), enumerable: true,
        configurable: true, writable: true,
      });
    }
  }
  seen.delete(value);
  return copy;
}

function inspectReferences(schema) {
  // Traverse schema locations only. A property named '$ref' or literal example
  // containing a URL is data, not a remote schema reference.
  const visit = (node, root = false) => {
    if (typeof node === 'boolean') return;
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new ToolSchemaError('Schema nodes must be objects or booleans');
    }
    for (const key of ['$id', '$anchor', '$dynamicAnchor', '$dynamicRef', '$recursiveRef', '$recursiveAnchor', '$async']) {
      if (Object.hasOwn(node, key)) throw new ToolSchemaError(`Unsupported schema keyword: ${key}`);
    }
    if (!root && Object.hasOwn(node, '$schema')) throw new ToolSchemaError('Nested schema dialects are unsupported');
    if (Object.hasOwn(node, '$ref')) {
      if (typeof node.$ref !== 'string' || !(node.$ref === '#' || node.$ref.startsWith('#/'))) {
        throw new ToolSchemaError('Only document-local JSON-pointer references are supported');
      }
    }
    for (const key of ['properties', 'patternProperties', '$defs', 'definitions', 'dependencies', 'dependentRequired', 'dependentSchemas']) {
      if (node[key] && typeof node[key] === 'object' && Object.hasOwn(node[key], '__proto__')) {
        // Ajv intentionally filters this key from several schema maps. Reject
        // such declarations rather than publish constraints it will not check.
        throw new ToolSchemaError('Schema map key __proto__ is unsupported by the validator');
      }
    }
    for (const key of ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']) {
      if (node[key] && typeof node[key] === 'object' && !Array.isArray(node[key])) {
        for (const child of Object.values(node[key])) visit(child);
      }
    }
    if (node.dependencies && typeof node.dependencies === 'object' && !Array.isArray(node.dependencies)) {
      for (const child of Object.values(node.dependencies)) if (!Array.isArray(child)) visit(child);
    }
    for (const key of ['additionalProperties', 'additionalItems', 'contains', 'not', 'if', 'then', 'else', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems', 'contentSchema']) {
      if (Object.hasOwn(node, key)) visit(node[key]);
    }
    if (Object.hasOwn(node, 'items')) {
      if (Array.isArray(node.items)) node.items.forEach((child) => visit(child));
      else visit(node.items);
    }
    for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
      if (Array.isArray(node[key])) node[key].forEach((child) => visit(child));
    }
  };
  visit(schema, true);
}

function compileSchema(raw) {
  const schema = cloneJson(raw);
  if (!schema || Array.isArray(schema) || schema.type !== 'object') {
    throw new ToolSchemaError('MCP tool parameters must explicitly declare type: object');
  }
  const bytes = Buffer.byteLength(JSON.stringify(schema));
  if (bytes > MAX_SCHEMA_BYTES) throw new ToolSchemaError('Tool schema exceeds the size limit');
  const dialect = schema.$schema;
  if (dialect !== undefined && dialect !== DRAFT7 && dialect !== DRAFT2020) {
    throw new ToolSchemaError('Unsupported JSON Schema dialect');
  }
  inspectReferences(schema);
  const Constructor = dialect === DRAFT2020 ? Ajv2020 : Ajv;
  const ajv = new Constructor({
    strict: true, strictRequired: false, allowUnionTypes: true,
    coerceTypes: false, useDefaults: false, removeAdditional: false,
    allErrors: false, validateFormats: true, ownProperties: true,
    // A new instance per schema prevents cross-tool $ref resolution.
    addUsedSchema: false,
  });
  let validate;
  try {
    validate = ajv.compile(schema);
  } catch {
    // Ajv messages may include user-controlled schema fragments. Keep errors
    // structural; callers can identify the tool by its own local snapshot.
    throw new ToolSchemaError('Tool schema is invalid or uses unsupported constraints');
  }
  return { schema, validate, bytes };
}

/** Snapshot DSH ToolSchema[] without widening or modifying input schemas. */
export function createToolRegistry(tools) {
  if (!Array.isArray(tools) || tools.length > MAX_TOOLS) throw new ToolSchemaError('Invalid tool list or too many tools');
  const source = tools.map((tool) => {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) throw new ToolSchemaError('Invalid DSH tool declaration');
    if (tool.hidden !== undefined) throw new ToolSchemaError('Hidden-tool metadata is unsupported; pass the visible DSH snapshot');
    if (typeof tool.name !== 'string' || !tool.name || tool.name.length > 512) throw new ToolSchemaError('Invalid DSH tool name');
    if (typeof tool.description !== 'string' || Buffer.byteLength(tool.description) > 65536) throw new ToolSchemaError('Invalid DSH tool description');
    return { name: tool.name, description: tool.description, parameters: tool.parameters };
  }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const originals = new Set();
  const byMcpName = new Map();
  const originalToMcp = new Map();
  let total = 0;
  source.forEach((tool, index) => {
    if (originals.has(tool.name)) throw new ToolSchemaError('Duplicate DSH tool name');
    originals.add(tool.name);
    const { schema, validate, bytes } = compileSchema(tool.parameters);
    total += bytes;
    if (total > MAX_TOTAL_SCHEMA_BYTES) throw new ToolSchemaError('Total tool schemas exceed the size limit');
    // The unique sorted rank prevents collisions even when sanitized names are
    // identical. No probabilistic hash collision assumption is necessary.
    const suffix = tool.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const name = `dsh_${index.toString(36)}_${suffix}`;
    const declaration = { name, description: tool.description, inputSchema: schema };
    byMcpName.set(name, { originalName: tool.name, declaration, validate });
    originalToMcp.set(tool.name, name);
  });
  return {
    toolNames: Object.freeze([...byMcpName.keys()]),
    list: () => [...byMcpName.values()].map(({ declaration }) => cloneJson(declaration)),
    get: (name) => byMcpName.get(name),
    mappedName: (name) => originalToMcp.get(name),
  };
}
