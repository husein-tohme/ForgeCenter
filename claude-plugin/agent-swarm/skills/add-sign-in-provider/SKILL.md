---
name: add-sign-in-provider
description: How to add a "Sign in with ..." provider to ForgeCenter (Google, which covers Gmail and Chrome accounts, or another OAuth/OpenID provider) in src/oauth.js, with verified emails, PKCE, setup keys and tests. Use when adding or fixing a sign-in option.
---

# Adding a sign-in provider

ForgeCenter already has GitHub, Microsoft and Discord in `PROVIDERS` in `src/oauth.js`. A provider turns on when `<ENV>_CLIENT_ID` and `<ENV>_CLIENT_SECRET` are set (or saved through one-click setup in `src/setup.js`).

## Which providers exist

- **Google**: one entry covers Gmail, Chrome and every Google account. OpenID Connect with PKCE.
- **Microsoft, GitHub, Discord**: already done.
- **ChatGPT / OpenAI**: there's no public "Sign in with OpenAI" for websites, so it can't be added. Say so instead of faking it.
- Claude never signs up for or logs in to these accounts itself. The person registers an OAuth app in the provider's console and pastes the keys; ForgeCenter then shows the button.

## Google entry

```js
google: {
  env: "GOOGLE",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scope: "openid email profile",
  pkce: true,
  // ID token comes straight from Google's token endpoint over TLS (OIDC Core 3.1.3.7).
  async profile({ id_token }) {
    const c = decodeJwtPayload(id_token);
    if (c.aud !== credentials(PROVIDERS.google).id || !c.sub) throw new Error("Unexpected Google ID token.");
    if (!["accounts.google.com", "https://accounts.google.com"].includes(c.iss)) throw new Error("Unexpected Google issuer.");
    const verified = c.email_verified === true;
    return { subject: c.sub, name: c.name || "Google user", picture: c.picture || null,
      email: verified ? c.email : null, emailVerified: verified, display: c.email || null };
  },
},
```

Rules (from CLAUDE.md): store the email only when `email_verified` is true; never log tokens; the redirect URI is `${BASE_URL}/api/auth/google/callback`.

## Also update

- The sign-in buttons and icon in `public/js/common.js`.
- `src/setup.js` so owners can paste Google keys, plus `.env.example` and the README setup steps.
- Tests in `test/`: stub `globalThis.fetch` for the token endpoint returning an ID token built from parts; cover verified email, unverified email (stored as null), wrong `aud`, and a bad `state`.
