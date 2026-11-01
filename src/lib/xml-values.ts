export type XmlPathMode = 'dot' | 'xpath' | 'env';

export type XmlValueItem = {
  key: string;
  value: string;
  kind: 'element' | 'attribute' | 'kv-tag';
};

export type XmlExtractOptions = {
  mode?: XmlPathMode;
  includeAttributes?: boolean;
  stripNamespaces?: boolean;
};

export type XmlExtractResult = {
  items: XmlValueItem[];
  notes: string[];
};

type XmlNode = {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (m, code) => {
    if (code === 'amp') return '&';
    if (code === 'lt') return '<';
    if (code === 'gt') return '>';
    if (code === 'quot') return '"';
    if (code === 'apos') return "'";
    if (code.startsWith('#x')) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return m;
  });
}

function parseAttributes(attrStr: string, stripNs: boolean): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_.:]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrStr)) !== null) {
    const rawName = m[1];
    if (rawName === 'xmlns' || rawName.startsWith('xmlns:')) continue;
    const name = stripNs ? rawName.replace(/^[^:]+:/, '') : rawName;
    const val = decodeEntities(m[2] ?? m[3] ?? '');
    attrs[name] = val;
  }
  return attrs;
}

export function parseXmlTree(input: string, stripNs = true): XmlNode {
  const s = input.trim();
  if (!s) throw new Error('Empty XML input.');

  const rootHolder: XmlNode = { name: '', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [rootHolder];

  const tokenRe = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<\/([a-zA-Z_:][-a-zA-Z0-9_.:]*)\s*>|<([a-zA-Z_:][-a-zA-Z0-9_.:]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_.:]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;

  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(s)) !== null) {
    if (m.index !== lastIndex) {
      const unexpected = s.slice(lastIndex, m.index).trim();
      if (unexpected) throw new Error(`Invalid XML near "${unexpected.slice(0, 30)}".`);
    }
    lastIndex = tokenRe.lastIndex;

    const [full, cdata, closeTag, openTag, attrPart, selfClose, textNode] = m;

    if (cdata !== undefined) {
      if (stack.length > 1) stack[stack.length - 1].text += cdata;
      continue;
    }

    if (full.startsWith('<!--') || full.startsWith('<?') || full.startsWith('<!DOCTYPE')) {
      continue;
    }

    if (closeTag !== undefined) {
      const cleanClose = stripNs ? closeTag.replace(/^[^:]+:/, '') : closeTag;
      if (stack.length <= 1) {
        throw new Error(`Invalid XML: unexpected closing tag </${closeTag}>.`);
      }
      const top = stack[stack.length - 1];
      if (top.name !== cleanClose) {
        throw new Error(`Invalid XML: expected </${top.name}> but found </${cleanClose}>.`);
      }
      stack.pop();
      continue;
    }

    if (openTag !== undefined) {
      const cleanOpen = stripNs ? openTag.replace(/^[^:]+:/, '') : openTag;
      const node: XmlNode = {
        name: cleanOpen,
        attrs: parseAttributes(attrPart || '', stripNs),
        children: [],
        text: '',
      };
      stack[stack.length - 1].children.push(node);
      if (!selfClose) {
        stack.push(node);
      }
      continue;
    }

    if (textNode !== undefined) {
      if (stack.length > 1) {
        stack[stack.length - 1].text += decodeEntities(textNode);
      } else if (textNode.trim()) {
        throw new Error(`Invalid XML: text outside root element.`);
      }
    }
  }

  if (lastIndex < s.length && s.slice(lastIndex).trim()) {
    throw new Error(`Invalid XML near "${s.slice(lastIndex, lastIndex + 30).trim()}".`);
  }

  if (stack.length > 1) {
    throw new Error(`Invalid XML: unclosed tag <${stack[stack.length - 1].name}>.`);
  }

  if (rootHolder.children.length === 0) {
    throw new Error('Invalid XML: no root element found.');
  }

  if (rootHolder.children.length > 1) {
    return { name: 'root', attrs: {}, children: rootHolder.children, text: '' };
  }

  return rootHolder.children[0];
}

function joinXmlPath(prefix: string, segment: string, index: number | null, totalSiblings: number, mode: XmlPathMode): string {
  const hasIdx = totalSiblings > 1 && index !== null;
  if (mode === 'xpath') {
    const idxPart = hasIdx ? `[${index + 1}]` : '';
    return `${prefix}/${segment}${idxPart}`;
  }
  if (mode === 'env') {
    const idxPart = hasIdx ? `__${index}` : '';
    const clean = segment.replace(/[^a-zA-Z0-9_]/g, '_');
    return prefix ? `${prefix}__${clean}${idxPart}` : `${clean}${idxPart}`;
  }
  const idxPart = hasIdx ? `[${index}]` : '';
  return prefix ? `${prefix}.${segment}${idxPart}` : `${segment}${idxPart}`;
}

function joinAttrPath(elPath: string, attrName: string, mode: XmlPathMode): string {
  if (mode === 'xpath') return `${elPath}/@${attrName}`;
  if (mode === 'env') return `${elPath}__${attrName.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  return `${elPath}.@${attrName}`;
}

export function extractXmlValues(input: string, opts: XmlExtractOptions = {}): XmlExtractResult {
  const raw = input.trim();
  if (!raw) return { items: [], notes: [] };

  const mode: XmlPathMode = opts.mode ?? 'dot';
  const includeAttributes = opts.includeAttributes ?? true;
  const stripNamespaces = opts.stripNamespaces ?? true;
  const notes: string[] = [];

  const root = parseXmlTree(raw, stripNamespaces);
  const items: XmlValueItem[] = [];
  let kvTagCount = 0;

  function visit(node: XmlNode, path: string, isRoot: boolean) {
    // Detect .NET / Spring style key-value tags:
    // <add key="K" value="V" /> or <add name="K" connectionString="V" /> or <property name="K" value="V" />
    if (node.children.length === 0 && !node.text.trim()) {
      const kAttr = node.attrs.key ?? node.attrs.name;
      const vAttr = node.attrs.value ?? node.attrs.connectionString;
      if (kAttr !== undefined && vAttr !== undefined && (node.name === 'add' || node.name === 'set' || node.name === 'property' || node.name === 'param')) {
        kvTagCount++;
        const parentPath = path.replace(/(\.|\/|__)(add|set|property|param)(\[\d+\]|__\d+)?$/, '');
        const kvPath = mode === 'xpath'
          ? `${parentPath}/${node.name}[@${node.attrs.key !== undefined ? 'key' : 'name'}='${kAttr}']`
          : mode === 'env'
          ? `${parentPath ? parentPath + '__' : ''}${kAttr.replace(/[^a-zA-Z0-9_]/g, '_')}`
          : `${parentPath ? parentPath + '.' : ''}${kAttr}`;
        items.push({ key: kvPath, value: vAttr, kind: 'kv-tag' });
        for (const [aName, aVal] of Object.entries(node.attrs)) {
          if (aName === 'key' || aName === 'name' || aName === 'value' || aName === 'connectionString') continue;
          if (includeAttributes) {
            items.push({ key: joinAttrPath(kvPath, aName, mode), value: aVal, kind: 'attribute' });
          }
        }
        return;
      }
    }

    if (includeAttributes) {
      for (const [aName, aVal] of Object.entries(node.attrs)) {
        items.push({ key: joinAttrPath(path, aName, mode), value: aVal, kind: 'attribute' });
      }
    }

    const trimmedText = node.text.trim();
    if (node.children.length === 0) {
      if (trimmedText || Object.keys(node.attrs).length === 0 || !includeAttributes) {
        items.push({ key: path, value: trimmedText, kind: 'element' });
      }
      return;
    }

    if (trimmedText) {
      items.push({ key: path, value: trimmedText, kind: 'element' });
    }

    // Count sibling tag occurrences so repeated tags get [0], [1] indices
    const counts = new Map<string, number>();
    for (const c of node.children) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
    const seen = new Map<string, number>();

    for (const c of node.children) {
      const idx = seen.get(c.name) ?? 0;
      seen.set(c.name, idx + 1);
      const total = counts.get(c.name) ?? 1;
      const childPath = joinXmlPath(isRoot && mode !== 'xpath' ? path : path, c.name, idx, total, mode);
      visit(c, childPath, false);
    }
  }

  const rootPath = mode === 'xpath' ? `/${root.name}` : root.name;
  visit(root, rootPath, true);

  if (kvTagCount > 0) {
    notes.push(`Detected ${kvTagCount} key/value config tag${kvTagCount > 1 ? 's' : ''} (e.g. <add key="…" value="…" />).`);
  }

  return { items, notes };
}
