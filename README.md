# Imposter — pass-the-phone word game

A single-file static web game. Everyone gets the same secret word except one player, who gets a closely related word. Flip your card, give clues, find the fraud.

## Deploy on Cloudflare (Git integration)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. Select this repo (`imposter-game`)
3. Build settings:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: **public**
4. Save and Deploy → live at `imposter-game.pages.dev`

Every push to `main` auto-deploys. A `wrangler.jsonc` is also included if you prefer deploying as a Worker with static assets (`npx wrangler deploy`).
