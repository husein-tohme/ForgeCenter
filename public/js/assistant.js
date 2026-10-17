import { $, api, esc, toast, onUser, openSignIn } from "./common.js";
import { avatarIcon, avatarLabel } from "./ai-avatars.js";

// The link's token is the only way in, so it stays in this tab and is sent with each message.
const token = new URLSearchParams(location.search).get("t") || "";
let assistant = null;
let chat = [];          // kept only in this tab; ForgeCenter doesn't store chats
let user = null;

$("signin-here").addEventListener("click", () => openSignIn());

function showMissing() {
  assistant = null;
  $("loading").hidden = true;
  $("card").hidden = true;
  $("missing").hidden = false;
  document.title = "Assistant not found · ForgeCenter";
}

async function load() {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return showMissing();
  const r = await api(`/api/assistants/shared/${encodeURIComponent(token)}`);
  if (r.status === 404) return showMissing();
  if (!r.ok) {
    $("loading").textContent = r.data.error || "The assistant couldn't load. Refresh the page to try again.";
    return;
  }
  assistant = r.data.assistant;
  $("loading").hidden = true;
  $("card").hidden = false;
  document.title = `${assistant.name} · ForgeCenter`;
  $("avatar").innerHTML = avatarIcon(assistant.avatar, avatarLabel(assistant.avatar));
  $("name").textContent = assistant.name;
  $("maker").textContent = `Made by ${assistant.maker} on ForgeCenter`;
  renderChat();
  renderAccess();
}

// Signed-in people with a finished account can chat; everyone else sees a sign-in button.
function renderAccess() {
  if (!assistant) return;
  const canChat = !!user?.ageGroup && user.ageGroup !== "under13";
  $("chat-form").hidden = !canChat;
  $("chat-signin").hidden = !!user;
}

onUser(u => { user = u; renderAccess(); });

const bubble = (role, text, extra = "") =>
  `<div class="msg-row ${role === "user" ? "from-customer" : "from-ai"}${extra}"><b>${role === "user" ? "You" : esc(assistant.name)}</b><p>${esc(text)}</p></div>`;

function renderChat(pending = null) {
  const thread = $("thread");
  thread.innerHTML = (assistant.greeting ? bubble("assistant", assistant.greeting) : "")
    + chat.map(m => bubble(m.role, m.content)).join("")
    + (pending ? bubble("user", pending) + bubble("assistant", "Thinking…", " typing") : "")
    || `<p class="hint">Say hi to start the chat.</p>`;
  thread.scrollTop = thread.scrollHeight;
  $("chat-input").disabled = !!pending;
  $("chat-send").disabled = !!pending;
}

$("chat-form").addEventListener("submit", async e => {
  e.preventDefault();
  const text = $("chat-input").value.trim();
  if (!text || !assistant) return;
  renderChat(text);
  const messages = [...chat, { role: "user", content: text }].slice(-20).map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  const r = await api(`/api/assistants/${assistant.id}/chat`, { method: "POST", body: { messages, token } });
  if (r.status === 404) return showMissing();
  if (!r.ok) { renderChat(); return toast(r.data.error || "The assistant couldn't answer. Try again in a moment."); }
  chat.push({ role: "user", content: text }, { role: "assistant", content: r.data.reply });
  $("chat-input").value = "";
  renderChat();
  if (typeof r.data.remaining === "number") {
    $("chat-note").textContent = `Chats aren't saved. You have ${r.data.remaining} AI ${r.data.remaining === 1 ? "message" : "messages"} left today.`;
  }
  $("chat-input").focus();
});

$("chat-input").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("chat-form").requestSubmit(); }
});

$("chat-clear").addEventListener("click", () => { chat = []; renderChat(); $("chat-input").focus(); });

load();
