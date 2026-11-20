/**
 * Leading YAML frontmatter splitting and lightweight parser, mirroring VS Code's
 * `yamlPreamble.ts` behaviour without pulling a full YAML runtime into the bundle.
 */

const FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/**
 * Split leading YAML frontmatter from a Markdown document.
 * Returns `null` when the document does not start with a closed `---` block.
 */
export function splitFrontmatter(text) {
  const value = String(text ?? '');
  const match = FRONTMATTER_RE.exec(value);
  if (!match) return null;
  return {
    source: match[1] ?? '',
    body: value.slice(match[0].length),
  };
}

/**
 * Parse a YAML frontmatter block into `{ entries: [key, value][], error: string | null }`.
 */
export function parseFrontmatterYaml(source) {
  try {
    const rawLines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
    const lines = [];
    for (let i = 0; i < rawLines.length; i += 1) {
      const raw = rawLines[i];
      if (/^\t/.test(raw)) {
        throw new Error(`第 ${i + 1} 行：YAML 缩进不能使用制表符`);
      }
      const indent = countIndent(raw);
      const trimmed = raw.slice(indent);
      if (!trimmed || trimmed.startsWith('#')) continue;
      lines.push({ indent, text: trimmed, raw, lineNo: i + 1 });
    }
    if (!lines.length) return { entries: [], error: null };

    const cursor = { index: 0 };
    const value = parseBlock(lines, cursor, lines[0].indent);
    if (cursor.index < lines.length) {
      throw new Error(`第 ${lines[cursor.index].lineNo} 行：缩进结构无效`);
    }
    if (value == null) return { entries: [], error: null };
    if (typeof value !== 'object' || Array.isArray(value)) {
      return { entries: [['', value]], error: null };
    }
    return { entries: Object.entries(value), error: null };
  } catch (error) {
    return { entries: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/** Format a nested object value concisely for table cell display (matching VS Code). */
export function formatFrontmatterObject(value, depth = 0) {
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value.map((item) => {
      const prefix = '  '.repeat(depth) + '- ';
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const inner = formatFrontmatterObject(item, depth + 1);
        return prefix + inner.trimStart();
      }
      return prefix + formatFrontmatterScalar(item);
    }).join('\n');
  }
  if (typeof value === 'object') {
    return Object.entries(value).map(([key, val]) => {
      const pad = '  '.repeat(depth);
      if (val && typeof val === 'object') {
        return `${pad}${key}:\n${formatFrontmatterObject(val, depth + 1)}`;
      }
      return `${pad}${key}: ${formatFrontmatterScalar(val)}`;
    }).join('\n');
  }
  return formatFrontmatterScalar(value);
}

export function formatFrontmatterScalar(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function countIndent(line) {
  let i = 0;
  while (i < line.length && line[i] === ' ') i += 1;
  return i;
}

function parseBlock(lines, cursor, baseIndent) {
  const first = lines[cursor.index];
  if (!first) return null;
  if (isSequenceItem(first.text)) {
    return parseSequence(lines, cursor, baseIndent);
  }
  if (findMappingColon(first.text) !== -1) {
    return parseMapping(lines, cursor, baseIndent);
  }
  const line = lines[cursor.index];
  cursor.index += 1;
  return parseInlineValue(stripInlineComment(line.text), line.lineNo);
}

function parseSequence(lines, cursor, baseIndent) {
  const out = [];
  while (cursor.index < lines.length) {
    const line = lines[cursor.index];
    if (line.indent < baseIndent) break;
    if (line.indent > baseIndent) {
      throw new Error(`第 ${line.lineNo} 行：意外的列表缩进`);
    }
    if (!isSequenceItem(line.text)) break;

    const rest = line.text.slice(1).trimStart();
    cursor.index += 1;

    if (!rest || rest.startsWith('#')) {
      const next = lines[cursor.index];
      if (next && next.indent > baseIndent) {
        out.push(parseBlock(lines, cursor, next.indent));
      } else {
        out.push(null);
      }
      continue;
    }

    const blockScalar = parseBlockScalarHeader(rest);
    if (blockScalar) {
      out.push(consumeBlockScalar(lines, cursor, baseIndent, blockScalar));
      continue;
    }

    const colonIdx = findMappingColon(rest);
    if (colonIdx !== -1) {
      // Inline mapping starting on the `- ` line, e.g. `- name: foo`
      const itemIndent = line.indent + (line.text.length - rest.length);
      const synthetic = { ...line, indent: itemIndent, text: rest };
      const obj = {};
      assignMappingLine(obj, synthetic, lines, cursor, itemIndent);
      while (cursor.index < lines.length) {
        const next = lines[cursor.index];
        if (next.indent < itemIndent) break;
        if (next.indent > itemIndent) {
          throw new Error(`第 ${next.lineNo} 行：意外的缩进`);
        }
        if (isSequenceItem(next.text) || findMappingColon(next.text) === -1) break;
        assignMappingLine(obj, next, lines, cursor, itemIndent);
      }
      out.push(obj);
      continue;
    }

    out.push(parseInlineValue(stripInlineComment(rest), line.lineNo));
  }
  return out;
}

function parseMapping(lines, cursor, baseIndent) {
  const out = {};
  while (cursor.index < lines.length) {
    const line = lines[cursor.index];
    if (line.indent < baseIndent) break;
    if (line.indent > baseIndent) {
      throw new Error(`第 ${line.lineNo} 行：意外的缩进`);
    }
    if (isSequenceItem(line.text)) break;
    if (findMappingColon(line.text) === -1) {
      throw new Error(`第 ${line.lineNo} 行：缺少键值对分隔符 ":"`);
    }
    assignMappingLine(out, line, lines, cursor, baseIndent);
  }
  return out;
}

function assignMappingLine(out, line, lines, cursor, baseIndent) {
  const colonIdx = findMappingColon(line.text);
  const rawKey = line.text.slice(0, colonIdx).trim();
  const key = unquoteKey(rawKey, line.lineNo);
  const rawRest = line.text.slice(colonIdx + 1).trim();
  if (cursor.index < lines.length && lines[cursor.index] === line) {
    cursor.index += 1;
  }

  const blockScalar = parseBlockScalarHeader(rawRest);
  if (blockScalar) {
    out[key] = consumeBlockScalar(lines, cursor, baseIndent, blockScalar);
    return;
  }

  const cleaned = stripInlineComment(rawRest);
  if (!cleaned) {
    const next = lines[cursor.index];
    if (next && (next.indent > baseIndent || (next.indent === baseIndent && isSequenceItem(next.text)))) {
      out[key] = parseBlock(lines, cursor, next.indent);
    } else {
      out[key] = null;
    }
    return;
  }

  out[key] = parseInlineValue(cleaned, line.lineNo);
}

function parseBlockScalarHeader(text) {
  const m = /^([|>])([+-]?)(?:\s+#.*)?$/.exec(text);
  if (!m) return null;
  return { style: m[1], chomp: m[2] || 'clip' };
}

function consumeBlockScalar(lines, cursor, parentIndent, header) {
  const collected = [];
  let blockIndent = null;
  while (cursor.index < lines.length) {
    const line = lines[cursor.index];
    if (line.indent <= parentIndent) break;
    if (blockIndent === null) blockIndent = line.indent;
    collected.push(line.raw.slice(Math.min(blockIndent, line.raw.length)));
    cursor.index += 1;
  }
  const joined = header.style === '>' ? collected.join(' ') : collected.join('\n');
  return header.chomp === '-' ? joined.replace(/\n+$/, '') : joined;
}

function isSequenceItem(text) {
  return text === '-' || text.startsWith('- ');
}

function findMappingColon(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (quote === '"' && ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) {
        if (quote === "'" && text[i + 1] === "'") {
          i += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#') return -1;
    if (ch === ':' && (i + 1 === text.length || /\s/.test(text[i + 1]))) {
      return i;
    }
  }
  return -1;
}

function stripInlineComment(text) {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (quote === '"' && ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) {
        if (quote === "'" && text[i + 1] === "'") {
          i += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth += 1;
    else if ((ch === ']' || ch === '}') && depth > 0) depth -= 1;
    else if (ch === '#' && depth === 0 && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i).trim();
    }
  }
  return text.trim();
}

function unquoteKey(raw, lineNo) {
  if (!raw) throw new Error(`第 ${lineNo} 行：键名不能为空`);
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return parseQuotedString(raw, lineNo);
  }
  return raw;
}

function parseQuotedString(text, lineNo) {
  const quote = text[0];
  if (text.length < 2 || text[text.length - 1] !== quote) {
    throw new Error(`第 ${lineNo} 行：未闭合的引号字符串`);
  }
  const inner = text.slice(1, -1);
  if (quote === "'") return inner.replace(/''/g, "'");
  return inner.replace(/\\(["\\/bfnrt]|u[0-9a-fA-F]{4})/g, (_, esc) => {
    switch (esc) {
      case '"': return '"';
      case '\\': return '\\';
      case '/': return '/';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      default: return String.fromCharCode(parseInt(esc.slice(1), 16));
    }
  });
}

function parseInlineValue(text, lineNo) {
  if (!text) return null;
  const first = text[0];
  if (first === '"' || first === "'") return parseQuotedString(text, lineNo);
  if (first === '[') return parseFlowArray(text, lineNo);
  if (first === '{') return parseFlowObject(text, lineNo);
  if (/^(?:null|~)$/i.test(text)) return null;
  if (/^(?:true|false)$/i.test(text)) return text.toLowerCase() === 'true';
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) {
    const num = Number(text);
    if (Number.isFinite(num)) return num;
  }
  return text;
}

function splitFlowTopLevel(inner, openChar, closeChar, lineNo) {
  const items = [];
  let quote = null;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (quote) {
      if (quote === '"' && ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) {
        if (quote === "'" && inner[i + 1] === "'") {
          i += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') {
      depth -= 1;
      if (depth < 0) throw new Error(`第 ${lineNo} 行：多余的 "${ch}"`);
    } else if (ch === ',' && depth === 0) {
      const part = inner.slice(start, i).trim();
      if (part) items.push(part);
      start = i + 1;
    }
  }
  if (quote) throw new Error(`第 ${lineNo} 行：未闭合的引号`);
  if (depth !== 0) throw new Error(`第 ${lineNo} 行：未闭合的 "${openChar}${closeChar}"`);
  const tail = inner.slice(start).trim();
  if (tail) items.push(tail);
  return items;
}

function parseFlowArray(text, lineNo) {
  if (!text.endsWith(']')) throw new Error(`第 ${lineNo} 行：未闭合的数组 "["`);
  const inner = text.slice(1, -1).trim();
  if (!inner) return [];
  return splitFlowTopLevel(inner, '[', ']', lineNo).map((item) => parseInlineValue(item, lineNo));
}

function parseFlowObject(text, lineNo) {
  if (!text.endsWith('}')) throw new Error(`第 ${lineNo} 行：未闭合的对象 "{"`);
  const inner = text.slice(1, -1).trim();
  if (!inner) return {};
  const obj = {};
  for (const entry of splitFlowTopLevel(inner, '{', '}', lineNo)) {
    const colonIdx = findMappingColon(entry);
    if (colonIdx === -1) throw new Error(`第 ${lineNo} 行：无效的对象字段 "${entry}"`);
    const key = unquoteKey(entry.slice(0, colonIdx).trim(), lineNo);
    const val = entry.slice(colonIdx + 1).trim();
    obj[key] = parseInlineValue(val, lineNo);
  }
  return obj;
}
