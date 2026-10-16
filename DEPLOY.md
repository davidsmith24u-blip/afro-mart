# Deploying Afro Mart

Netlify serves the storefront from `public/` and runs the whole API in one Function
(`netlify/functions/api.mjs`). The SQLite database is snapshotted to Netlify Blobs between
requests, so the app survives cold starts. For low-traffic shops this is enough; for heavy
concurrent writes run the app on a long-running Node host and use Netlify only for the frontend.

The recommended setup is **Git-connected auto-deploy**: connect the GitHub repo once, and every
push to `main` builds and deploys automatically.

## 1. Get the latest code onto GitHub

Netlify builds from GitHub, so the commits that only exist locally must be pushed first.

**From this machine (needs a GitHub token):**

```powershell
$env:GITHUB_TOKEN = 'ghp_...'   # a token with repo / contents:write access
git push "https://x-access-token:$env:GITHUB_TOKEN@github.com/davidsmith24u-blip/afro-mart.git" main
Remove-Item Env:\GITHUB_TOKEN
```

**Or**, if you already have the repo cloned somewhere with working credentials:

```sh
git push origin main
```

A token with only `repo` (classic) or `contents: write` (fine-grained) scope is enough.

## 2. Connect Netlify to the repository

1. Netlify → **Add new site** → **Import an existing project**.
2. Choose **GitHub**, authorize, and pick `davidsmith24u-blip/afro-mart`.
3. Branch to deploy: **`main`**.
4. Build settings are read from `netlify.toml`, so they should already show:
   - Build command: `npm install`
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
   - Node version: **24** (from `.nvmrc` / `netlify.toml`)
5. Add environment variables (Site settings → Environment variables):
   - **`AUTH_SECRET`** — a long random string (required so sessions survive restarts)
   - Optional: `DELIVERY_FEE_DEFAULT_CENTS`, `PAYMENTS_WEBHOOK_SECRET`, `WHATSAPP_NUMBER`,
     `SUPPORT_EMAIL`, `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`, `AI_PROVIDER`,
     `COMMS_WEBHOOK_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`

   `WHATSAPP_NUMBER` (international format, digits only) and `SUPPORT_EMAIL` are optional; when set, the
   storefront shows a contact section with a WhatsApp chat button and an email link. `AI_API_KEY` enables
   the AI assistant and copywriter; with no key they fall back to built-in smart matching.
6. **Deploy site**.

From then on, every push to `main` redeploys. Pull requests get their own Deploy Previews.

## 3. Verify the live site

The store is live at **https://afromartz.biz/** (custom domain) and
**https://afro-mart-store.netlify.app/** (Netlify URL).

- `https://afromartz.biz/` — storefront
- `https://afromartz.biz/api/config` — app config
- `https://afromartz.biz/api/products` — catalog (seeds products on first request)
- `https://afromartz.biz/admin` — staff dashboard (`ADMIN_EMAIL` / `ADMIN_PASSWORD`)

## Custom domain (`afromartz.biz`)

`afromartz.biz` is the custom domain of the `afro-mart-store` site (apex + `www`, on Netlify DNS).
Netlify issues and renews the TLS certificate automatically once the domain resolves to the site.

⚠️ On the current (free/dev) plan Netlify allows **at most 3 custom-domain changes per hour per
site** — attaching, detaching and alias edits all count. Detaching also **deletes the managed
`NETLIFY` DNS records** for the domain, so don't detach it as a diagnostic: the domain will 404
until it is re-attached.

## Alternative: deploy without Git

If you would rather not connect the repo, deploy straight from this clone. This needs a Netlify
personal access token (User settings → Applications → Personal access tokens):

```sh
npx netlify-cli@27 login
npx netlify-cli@27 sites:create --name afro-mart-store
npx netlify-cli@27 deploy --build --prod
```

This is a one-off deploy, not auto-deploy — repeat it to publish changes.

## Notes

- The repository also contains `.github/workflows/static.yml`, a GitHub Pages workflow that is
  unrelated to this deployment and currently fails. It runs on every push. Disable it under
  **Settings → Actions** if the noise bothers you; it does not affect Netlify.
- Netlify Blobs is a key-value store, not a database. Traffic here is low, so it is fine.
