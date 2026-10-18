import { $, api, toast, onUser } from "./common.js";

const params = new URLSearchParams(location.search);
const RESULT = {
  on: "GitHub sign-in is on. Open the sign-in button at the top to try it.",
  failed: "GitHub didn't finish creating the app. Try again; if it keeps failing, check the server log.",
  expired: "That setup took too long or was opened twice. Press the button again.",
};
if (RESULT[params.get("github")]) toast(RESULT[params.get("github")]);

for (const p of ["discord", "microsoft"]) $(`${p}-cb`).textContent = `${location.origin}/api/auth/${p}/callback`;

let code = "";

async function load() {
  const r = await api("/api/setup/status");
  if (!r.ok) return;
  const s = r.data;
  $("unlock").hidden = !(s.needsCode && s.codeActive && !code);
  if (s.github) {
    $("github-status").textContent = s.githubFromEnv ? "On (set in the environment settings)." : "On. People can sign in with GitHub.";
    $("github-go").hidden = $("github-help").hidden = true;
  } else if (!s.secrets) {
    $("github-status").textContent = "Add a SECRET_KEY (32+ characters) to the environment first, so the keys can be stored safely.";
  } else if (s.needsCode && !s.codeActive) {
    $("github-status").textContent = "Sign in as the owner to change sign-in settings.";
  } else {
    $("github-status").textContent = "Off.";
    $("github-go").hidden = $("github-help").hidden = (s.needsCode && !code);
  }
}

$("code-form").addEventListener("submit", e => {
  e.preventDefault();
  code = $("code").value.trim();
  load();
});

$("github-go").addEventListener("click", async e => {
  e.target.disabled = true;
  const r = await api("/api/setup/github/start", { method: "POST", body: { code } });
  if (!r.ok) { e.target.disabled = false; return toast(r.data.error); }
  // GitHub's manifest flow takes a normal form post, not a fetch.
  const form = document.createElement("form");
  form.method = "post";
  form.action = r.data.action;
  const input = document.createElement("input");
  input.type = "hidden"; input.name = "manifest"; input.value = r.data.manifest;
  form.append(input);
  document.body.append(form);
  form.submit();
});

onUser(() => load());
