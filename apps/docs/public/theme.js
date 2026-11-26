/* global localStorage, matchMedia, document */
// Applies the saved or system theme before the first paint (no flash). A file rather than an inline script,
// so the site works under a Content-Security-Policy with script-src 'self' (no 'unsafe-inline', no hashes).
try {
  var t = localStorage.getItem('mc-docs-theme');
  if (t !== 'light' && t !== 'dark')
    t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
} catch {
  // Storage blocked: keep the default theme.
}
