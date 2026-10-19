import { $, api, esc } from "./common.js";
const chat = $("chat");
const add = (who, text) => { chat.insertAdjacentHTML("beforeend", `<div class="msg ${who}">${esc(text)}</div>`); chat.lastElementChild.scrollIntoView({ block: "nearest" }); };
$("ask").addEventListener("submit", async e => {
  e.preventDefault();
  const q = $("question").value.trim();
  if (!q) return;
  add("me", q); $("question").value = "";
  const r = await api("/api/ai/ask", { method: "POST", body: { question: q } });
  add("ai", r.ok ? r.data.reply : r.data.error);
});
