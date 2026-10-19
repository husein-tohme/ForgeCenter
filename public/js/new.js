import { $, api, onUser, openSignIn, toast } from "./common.js";
onUser(user => { if (!user) openSignIn(); });
$("new-repo").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  const r = await api("/api/repos", { method: "POST", body: { name: f.elements.name.value.trim(), description: f.description.value, private: f.vis.value === "private", readme: f.readme.checked } });
  if (!r.ok) return r.status === 401 ? openSignIn() : toast(r.data.error);
  location.assign(`/${r.data.repo.owner}/${encodeURIComponent(r.data.repo.name)}`);
});
