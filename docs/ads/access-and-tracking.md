# Account access and tracking

To launch the campaigns from this machine, the ad accounts need to be connected through their APIs. Do **not** paste secrets into chat. Put them in a local file that is never committed:

`C:\Users\Admin\afro-mart\.ads-secrets.json`

That file is already ignored by git. A template is in `.ads-secrets.example.json`.

## What is needed

### Meta (Facebook + Instagram)

From Meta Business Manager:

- Business Manager ID
- Ad Account ID (format `act_1234567890`)
- Facebook Page ID for Afro Mart
- Meta Pixel ID (create one in Events Manager if it does not exist)
- A **System User access token** with:
  - `ads_management`
  - `ads_read`
  - `business_management`
  - `pages_read_engagement`
  - `pages_manage_ads`
- Confirmation that a payment method is attached to the ad account

The token is created in Business Settings → Users → System Users → Add → Generate token.

### Google Ads

- Google Ads customer ID (format `123-456-7890`)
- Developer token (Google Ads API)
- OAuth refresh token with the `https://www.googleapis.com/auth/adwords` scope
- Confirmation that billing is active

### TikTok Ads

- Advertiser ID
- Access token with ad-management scope
- Confirmation that billing is active

TikTok is paused in Phase 1, so this can wait.

## Tracking the site needs

The storefront currently has no Meta Pixel or Google Ads tag. Before spending money, add:

- Meta Pixel base code + `PageView`
- Meta standard events: `ViewContent`, `AddToCart`, `InitiateCheckout`, `Purchase`
- Google Ads tag + conversions: `Purchase`, `AddToCart`
- Consent-gated loading: marketing scripts must not fire before the visitor accepts cookies
- `Impressum` and `Datenschutz` pages (required for advertising in Germany)

## UTM convention

Use these parameters so reports stay readable:

| Platform | `utm_source` | `utm_medium` | `utm_campaign` |
|---|---|---|---|
| Meta | `facebook` | `paid_social` | `ng_diaspora_de` |
| Google | auto-tagged | auto-tagged | `search_nrw` |
| TikTok | `tiktok` | `paid_social` | `ng_diaspora_de` |

Use `utm_content` for the creative name (for example `hero`, `product_grid`, `carousel_garri`).

## Safety notes

- Keep the ad account’s payment method and spending limit under the owner’s control.
- Start with the €10/day cap and a hard monthly limit of €300.
- Pause all campaigns immediately if spend runs ahead of the plan or the site goes down.
- The Netlify production deploy workaround is still in use; confirm the site is live before scaling spend.
