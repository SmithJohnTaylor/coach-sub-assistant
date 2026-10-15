# Live-sharing relay

A Cloudflare Worker with one Durable Object per shared game. The coach's phone sends the whole game on every change. The relay keeps the latest copy and passes it on to everyone watching. The wire format is in [`../src/live/protocol.ts`](../src/live/protocol.ts).

- `GET /live/:id?role=owner|watch` opens a WebSocket. The owner's first message is `{ type: 'auth', key }`, and the first key to arrive claims the share id.
- `POST /live/:id/stop` with the owner key as the body ends the share for everyone.
- Shared games are deleted 24 hours after the last change, or when the owner stops. Only an "ended" marker is kept, so an old game can't start sharing again by accident.

The free Workers plan covers this easily: one connection per phone, and a message on each sub plus a ping every 20 seconds.

## Develop and test

```sh
npm install
npm run dev     # http://localhost:8787, reachable from your LAN
npm test        # runs inside the Workers runtime (Miniflare)
npm run typecheck
```

## First deploy

1. **Cloudflare account.** Sign up for the free plan at https://dash.cloudflare.com.
2. **Move DNS to Cloudflare.** A Worker can only answer on `live.subassistant.soccer` if Cloudflare manages the domain's DNS. The domain can stay registered at Porkbun.
   - In Cloudflare: **Add a domain**, `subassistant.soccer`, Free plan. It imports the existing records. Check that the GitHub Pages ones came across: the `A`/`AAAA` records for the apex and any `www` CNAME. Set them to **DNS only** (grey cloud) so GitHub keeps issuing the HTTPS certificate.
   - At Porkbun: replace the nameservers with the two Cloudflare gives you. The domain is live on Cloudflare once its dashboard says **Active**, usually within an hour.
3. **Deploy:**
   ```sh
   npx wrangler login
   npm run deploy
   ```
   Wrangler creates the `live.subassistant.soccer` DNS record and certificate (see `routes` in `wrangler.jsonc`).
4. **Check it:** `curl https://live.subassistant.soccer/` should answer `Sub Assistant live relay` (with a 404 status, which is expected).

Then merge to `main`. The app build points at `wss://live.subassistant.soccer` (`../.env.production`), so the **Share live view** button appears once that build deploys.

**Without moving DNS:** remove `routes` from `wrangler.jsonc` and deploy. That gives you `https://sub-assistant-live.<your-subdomain>.workers.dev`. Then set `VITE_LIVE_URL=wss://sub-assistant-live.<your-subdomain>.workers.dev` in `../.env.production`.

## Automatic deploys

`.github/workflows/deploy-live.yml` tests and deploys the relay when `server/` or the protocol changes on `main`. It needs two repo secrets:

- `CLOUDFLARE_API_TOKEN`: create it from the **Edit Cloudflare Workers** template under My Profile → API Tokens.
- `CLOUDFLARE_ACCOUNT_ID`: shown on the Workers & Pages overview.

Until those secrets exist, deploy by hand as above.
