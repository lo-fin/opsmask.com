// A single, quiet "support" line shown after the user gets value (e.g. copying a prompt).
// Shown at most once per browser session.
const KEY = 'opsmask-support-nudge';

export function supportNudge(target: HTMLElement, kofiUrl: string) {
  if (!kofiUrl) return;
  try {
    if (sessionStorage.getItem(KEY)) return;
    sessionStorage.setItem(KEY, '1');
  } catch { /* storage blocked: still show once on this page */ }
  if (target.querySelector('.nudge')) return;
  const p = document.createElement('p');
  p.className = 'nudge';
  p.innerHTML = `Saved you some time? <a href="${kofiUrl}" rel="noopener">Support OpsMask on Ko-fi</a>.`;
  target.appendChild(p);
}
