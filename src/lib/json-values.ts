import { stripJsonComments } from './secret-input';

export type FlattenMode = 'dot' | 'env' | 'top';

export type ValueType = 'string' | 'number' | 'boolean' | 'null' | 'json';

export type JsonValueItem = {
  key: string;
  value: string;
  type: ValueType;
};

export type ExtractOptions = {
  mode?: FlattenMode;
  unwrapJsonStrings?: boolean;
};

export type ExtractResult = {
  items: JsonValueItem[];
  hasNested: boolean;
  notes: string[];
};

function tryParseJsonContainer(s: string): Record<string, unknown> | unknown[] | null {
  const t = s.trim();
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try {
      const parsed = JSON.parse(t);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
  }
  return null;
}

function joinKey(prefix: string, k: string | number, mode: FlattenMode): string {
  if (!prefix) return typeof k === 'number' ? `[${k}]` : k;
  if (mode === 'env') return `${prefix}__${k}`.replace(/:/g, '__');
  return typeof k === 'number' ? `${prefix}[${k}]` : `${prefix}.${k}`;
}

export function extractJsonValues(input: string, opts: ExtractOptions = {}): ExtractResult {
  const raw = input.trim();
  if (!raw) return { items: [], hasNested: false, notes: [] };

  const mode: FlattenMode = opts.mode ?? 'dot';
  const unwrap = opts.unwrapJsonStrings ?? true;
  const notes: string[] = [];

  let root: unknown;
  try {
    root = JSON.parse(stripJsonComments(raw));
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`);
  }

  // Handle double-encoded JSON string pasted with quotes: "{\"a\": 1}"
  if (typeof root === 'string') {
    const inner = tryParseJsonContainer(root);
    if (inner) {
      root = inner;
      notes.push('Unwrapped quoted JSON string.');
    } else {
      return {
        items: [{ key: '(value)', value: root, type: 'string' }],
        hasNested: false,
        notes,
      };
    }
  }

  if (root === null || typeof root !== 'object') {
    return {
      items: [{ key: '(value)', value: root === null ? 'null' : String(root), type: root === null ? 'null' : (typeof root as ValueType) }],
      hasNested: false,
      notes,
    };
  }

  const items: JsonValueItem[] = [];
  let hasNested = false;
  let unwrappedCount = 0;

  function visit(node: unknown, prefix: string, depth: number) {
    if (node !== null && typeof node === 'object') {
      if (depth > 0) hasNested = true;
      if (mode === 'top' && depth > 0) {
        items.push({ key: prefix, value: JSON.stringify(node), type: 'json' });
        return;
      }
      if (Array.isArray(node)) {
        if (node.length === 0) {
          items.push({ key: prefix || '[]', value: '[]', type: 'json' });
          return;
        }
        node.forEach((child, i) => visit(child, joinKey(prefix, i, mode), depth + 1));
      } else {
        const entries = Object.entries(node as Record<string, unknown>);
        if (entries.length === 0) {
          items.push({ key: prefix || '{}', value: '{}', type: 'json' });
          return;
        }
        for (const [k, v] of entries) {
          const nextKey = joinKey(prefix, mode === 'env' ? k.replace(/:/g, '__') : k, mode);
          visit(v, nextKey, depth + 1);
        }
      }
      return;
    }

    if (typeof node === 'string' && unwrap) {
      const inner = tryParseJsonContainer(node);
      if (inner) {
        hasNested = true;
        unwrappedCount++;
        if (mode === 'top') {
          items.push({ key: prefix, value: JSON.stringify(inner), type: 'json' });
        } else {
          visit(inner, prefix, depth + 1);
        }
        return;
      }
    }

    if (node === null || node === undefined) {
      items.push({ key: prefix, value: '', type: 'null' });
    } else if (typeof node === 'boolean') {
      items.push({ key: prefix, value: String(node), type: 'boolean' });
    } else if (typeof node === 'number') {
      items.push({ key: prefix, value: String(node), type: 'number' });
    } else {
      items.push({ key: prefix, value: String(node), type: 'string' });
    }
  }

  visit(root, '', 0);

  if (unwrappedCount > 0) {
    notes.push(`Parsed ${unwrappedCount} embedded JSON string${unwrappedCount > 1 ? 's' : ''}.`);
  }

  return { items, hasNested, notes };
}
