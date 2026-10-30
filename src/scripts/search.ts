// Tiny client-side search over /search.json (built at compile time). No server, no tracking.
export type SearchItem = { type: 'Tool' | 'Cheatsheet' | 'Prompt'; title: string; description: string; url: string; keywords: string };

let cache: Promise<SearchItem[]> | null = null;
export function loadIndex(): Promise<SearchItem[]> {
  cache ??= fetch('/search.json').then((r) => r.json()).catch(() => []);
  return cache;
}

export function search(items: SearchItem[], query: string, limit = 8): SearchItem[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const scored = items
    .map((it) => {
      const title = it.title.toLowerCase();
      const kw = it.keywords.toLowerCase();
      const desc = it.description.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (title.includes(t)) score += title.startsWith(t) ? 6 : 4;
        else if (kw.includes(t)) score += 3;
        else if (desc.includes(t)) score += 1;
        else return { it, score: 0 };
      }
      return { it, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.it);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Wires an input + list into a keyboard-navigable search box. */
export function bindSearch(input: HTMLInputElement, list: HTMLElement) {
  let active = -1;
  const render = async () => {
    const items = await loadIndex();
    const q = input.value.trim();
    const results = search(items, q);
    active = results.length ? 0 : -1;
    if (!q) { list.innerHTML = ''; list.hidden = true; return; }
    list.hidden = false;
    list.innerHTML = results.length
      ? results
          .map(
            (r, i) =>
              `<li role="option" aria-selected="${i === 0}"><a href="${r.url}"><span class="r-type">${r.type}</span><span class="r-title">${esc(r.title)}</span><span class="r-desc">${esc(r.description)}</span></a></li>`,
          )
          .join('')
      : `<li class="r-empty">Nothing matches “${esc(q)}”. Try a tool name like jwt, cron or cidr.</li>`;
  };
  const move = (d: number) => {
    const opts = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
    if (!opts.length) return;
    active = (active + d + opts.length) % opts.length;
    opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === active)));
    opts[active].scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('input', render);
  input.addEventListener('focus', () => loadIndex());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') {
      const a = list.querySelector<HTMLAnchorElement>('[aria-selected="true"] a');
      if (a) { e.preventDefault(); location.href = a.href; }
    }
  });
}
