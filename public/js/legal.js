import { api } from "./common.js";

api("/api/config").then(r => {
  const email = r.data.contactEmail;
  if (!email) return;
  document.querySelectorAll("[data-contact]").forEach(el => {
    el.innerHTML = "";
    const a = document.createElement("a");
    a.href = `mailto:${email}`; a.textContent = email;
    el.append(a);
  });
});
