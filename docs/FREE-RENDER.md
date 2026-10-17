# Put ForgeCenter online for $0 with no card (Render + Supabase)

Render runs the website on its free plan. Render's free disk is wiped every time the site restarts, so Litestream backs the database up to free Supabase Storage every second and puts it back when the site starts.

What to know about free:
- The site sleeps after 15 minutes with no visitors. The next visitor waits about a minute while it wakes up.
- Customer Discord bots don't run on the free plan (they'd stop whenever the site sleeps).
- Uploaded pictures and other files stored on disk aren't backed up, only the database.

## 1. Supabase (the backup storage)

1. Sign in at [supabase.com](https://supabase.com) with GitHub and create a free project.
2. **Storage → New bucket**: name it `forgecenter-backups`, keep it private.
3. **Storage → Settings** (S3 connection): turn the S3 connection on and note the **Endpoint** (like `https://<project>.supabase.co/storage/v1/s3`) and **Region** (like `eu-west-1`).
4. **New access key**: copy the **Access key ID** and **Secret access key** somewhere safe. The secret is shown once.

## 2. Render (the website)

1. Sign in at [render.com](https://render.com) with GitHub.
2. Open [dashboard.render.com/blueprint/new?repo=https://github.com/husein-tohme/ForgeCenter](https://dashboard.render.com/blueprint/new?repo=https://github.com/husein-tohme/ForgeCenter).
3. Fill in:
   - `LITESTREAM_ENDPOINT`, `LITESTREAM_REGION`, `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY`: the four values from Supabase.
   - `ADMIN_EMAILS`: the email you'll sign in with.
   - Leave everything else empty for now; each one turns on a feature later.
4. Press **Apply**. The first build takes a few minutes. Your site is at `https://forgecenter.onrender.com` (or the name Render shows).

## Later

- Add keys any time in Render → your service → **Environment**; the site restarts with them.
- The owner page `/sign-in-setup` shows exactly how to turn on Google, GitHub, Microsoft and Discord sign-in (all free).
- To roll the database back, Litestream keeps 24 hours of history in the bucket.
