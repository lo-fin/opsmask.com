// Copies text to the clipboard and shows the result on the button that was pressed.
// Falls back to execCommand when the Clipboard API is blocked (http, permissions), and
// as a last resort selects the source so the user can press Ctrl+C.

let live: HTMLElement | null = null;
function announce(msg: string) {
  if (!live) {
    live = document.createElement('div');
    live.setAttribute('role', 'status');
    live.className = 'sr-only';
    document.body.appendChild(live);
  }
  live.textContent = '';
  // A fresh text node makes screen readers repeat the same message.
  setTimeout(() => (live!.textContent = msg), 50);
}

function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  return ok;
}

function selectSource(source?: HTMLElement | null) {
  if (!source) return;
  if (source instanceof HTMLTextAreaElement || source instanceof HTMLInputElement) {
    source.focus();
    source.select();
  } else {
    const range = document.createRange();
    range.selectNodeContents(source);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
}

const timers = new WeakMap<HTMLElement, number>();

/** Shows a short state on the button, then restores its label. */
function flash(btn: HTMLElement, label: string, state: 'ok' | 'fail') {
  if (!btn.dataset.label) btn.dataset.label = btn.textContent ?? 'Copy';
  // Keep the width so the layout does not jump.
  btn.style.minWidth = `${btn.getBoundingClientRect().width}px`;
  btn.textContent = label;
  btn.classList.toggle('is-copied', state === 'ok');
  btn.classList.toggle('is-copy-failed', state === 'fail');
  clearTimeout(timers.get(btn));
  timers.set(btn, window.setTimeout(() => {
    btn.textContent = btn.dataset.label!;
    btn.classList.remove('is-copied', 'is-copy-failed');
    btn.style.minWidth = '';
  }, state === 'ok' ? 1500 : 2500));
}

/** Copies `text` and gives feedback on `btn`. `source` is selected if copying is not possible. */
export async function copyText(btn: HTMLElement, text: string, source?: HTMLElement | null): Promise<boolean> {
  if (!text.trim()) {
    flash(btn, 'Nothing to copy', 'fail');
    announce('Nothing to copy');
    return false;
  }
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    ok = legacyCopy(text);
  }
  if (ok) {
    flash(btn, '✓ Copied', 'ok');
    announce('Copied to clipboard');
  } else {
    flash(btn, 'Press Ctrl+C', 'fail');
    announce('Could not copy. The text is selected, press Ctrl+C.');
    selectSource(source);
  }
  return ok;
}
