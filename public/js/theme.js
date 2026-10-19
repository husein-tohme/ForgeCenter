// Runs in <head> before the page draws, so there's no flash of the wrong theme.
try {
  const t = localStorage.getItem("fh-theme") ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  document.documentElement.dataset.theme = t;
} catch {}
