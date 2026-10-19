import { $, api, esc, onUser, openSignIn, refreshUser, signOut, toast } from "./common.js";
onUser(user => {
  const box = $("settings");
  if (!user) { box.innerHTML = `<div class="empty"><p>Sign in to change your settings.</p><button class="btn btn-primary" id="si">Sign in</button></div>`; $("si").onclick = () => openSignIn(); return; }
  box.innerHTML = `
    <form class="panel form" id="profile-form"><h2>Profile</h2>
      <label>Display name<input name="displayName" maxlength="50" value="${esc(user.name)}"></label>
      <label>Bio<textarea name="bio" maxlength="300">${esc(user.bio)}</textarea></label>
      <label>Website<input name="website" type="url" placeholder="https://" value="${esc(user.website ?? "")}"></label>
      <button class="btn btn-primary">Save profile</button></form>
    <form class="panel form" id="uname-form"><h2>Username</h2><p class="small muted">Changing it changes your profile and repo addresses.</p>
      <label>Username<input name="username" value="${esc(user.username ?? "")}" maxlength="39"></label><button class="btn">Change username</button></form>
    <section class="panel form"><h2>Account type</h2>
      ${["personal", "student", "business"].map(t => `<label class="check"><input type="radio" name="atype" value="${t}" ${user.accountType === t ? "checked" : ""}> ${{ personal: "Personal", student: "Student", business: "Business (covered by the business section of the privacy policy)" }[t]}</label>`).join("")}</section>
    <section class="panel form"><h2>Emails</h2><label class="check"><input type="checkbox" id="email-updates" ${user.emailUpdates ? "checked" : ""}> Send me emails about sales and updates. You can unsubscribe any time.</label></section>
    <section class="panel form"><h2>Age group</h2><p>${user.ageGroup === "adult" ? "Adult: you can sell." : "Teen: you can make repos, run sites and buy. Selling unlocks at 18."}</p></section>
    <section class="panel form"><h2>Your data</h2><p class="muted">Download everything Forgehub stores about you as a JSON file. Download repo files with each repo's Download zip button.</p><a class="btn" href="/api/me/export" download>Download my data</a></section>
    <section class="panel form"><h2>Sign out</h2><button class="btn" id="signout">Sign out</button></section>
    <section class="panel form"><h2>Delete account</h2><p class="muted">Deletes your profile, repos and files now. Records of past purchases are kept without your name for tax rules.</p><button class="btn btn-danger" id="delete">Delete my account</button></section>`;
  $("profile-form").onsubmit = async e => {
    e.preventDefault();
    const f = e.target.elements;
    const r = await api("/api/me", { method: "PATCH", body: { name: f.displayName.value, bio: f.bio.value, website: f.website.value } });
    toast(r.ok ? "Saved." : r.data.error);
  };
  $("uname-form").onsubmit = async e => {
    e.preventDefault();
    const r = await api("/api/me/username", { method: "POST", body: { username: e.target.elements.username.value.toLowerCase() } });
    if (!r.ok) return toast(r.data.error);
    await refreshUser(); toast(`You're now @${r.data.user.username}.`);
  };
  box.querySelectorAll("[name=atype]").forEach(i => i.onchange = () => api("/api/me", { method: "PATCH", body: { accountType: i.value } }).then(() => toast("Saved.")));
  $("email-updates").onchange = e => api("/api/me", { method: "PATCH", body: { emailUpdates: e.target.checked } }).then(() => toast("Saved."));
  $("signout").onclick = signOut;
  $("delete").onclick = async () => {
    if (prompt("This can't be undone. Type DELETE to delete your account.") !== "DELETE") return;
    const r = await api("/api/me", { method: "DELETE" });
    if (!r.ok) return toast(r.data.error);
    location.assign("/");
  };
});
