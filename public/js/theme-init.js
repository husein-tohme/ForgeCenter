// Runs before the page draws, so it opens in the right light/dark mode with no flash.
// Your choice is kept on this device; without one, your system setting is used.
try {
  const saved = localStorage.getItem("fc-theme");
  const light = saved ? saved === "light" : matchMedia("(prefers-color-scheme: light)").matches;
  document.documentElement.dataset.theme = light ? "light" : "dark";
} catch { document.documentElement.dataset.theme = "dark"; }
