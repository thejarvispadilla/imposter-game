# Imposter — party word game (multiplayer)

Everyone joins from their own phone. The host creates a room and shares a 4-letter code. Everyone gets the same secret word — except one player, who gets a closely related word. Give clues, vote, catch the fraud. Points persist across rounds.

## Scoring

- Vote for the real imposter: **+1** (even if the table's plurality got it wrong)
- Imposter escapes (wrong accusation or tied vote): **imposter +3**
- Imposter caught but steals (guesses the crew's word): **imposter +2**

## Architecture

- `public/index.html` — the whole client (static asset)
- `src/worker.js` — Cloudflare Worker + a `GameRoom` Durable Object per room code; WebSockets keep every phone in sync; rooms expire after 24h idle

## Deploy on Cloudflare (Git integration)

Durable Objects require a **Worker**, not a Pages project.

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Workers** tab → **Import a repository**
2. Select this repo (`imposter-game`)
3. Build settings: leave build command empty; deploy command `npx wrangler deploy`
4. Deploy → live at `imposter-game.<your-subdomain>.workers.dev`

Every push to `main` auto-deploys. Local dev: `npm i && npm run dev`.
