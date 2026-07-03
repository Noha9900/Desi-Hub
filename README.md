# Desi Hub Telegram Bridge

A Node.js bot that connects your Desi Hub WordPress site to Telegram:

- Auto-posts every new Comic/Story/Album to subscribers (green-styled Download button + red Get Membership button)
- Sells membership: after payment, sends a confirmation, a bill, and per-member self-destructing VIP invite link(s)
- Auto-kicks expired members from your VIP channel(s) and reminds them to renew
- Runs equally well on a VPS or on free-tier PaaS (Render, Koyeb, Heroku)

## 1. Create the bot on Telegram

1. Message **@BotFather** → `/newbot` → follow the prompts → copy the **token** it gives you.
2. Create your VIP channel(s) if you haven't already (private channels).
3. Add the bot to each VIP channel **as an admin**, with "Invite Users via Link" and "Ban Users" permissions enabled — it needs both to issue/revoke invite links and to kick expired members.
4. Get each channel's numeric ID: add [@userinfobot](https://t.me/userinfobot) or [@RawDataBot](https://t.me/RawDataBot) to the channel briefly, or forward a message from the channel to it — you want the `-100...` style ID.
5. Message [@userinfobot](https://t.me/userinfobot) yourself to get **your own** numeric Telegram ID (this becomes `ADMIN_TELEGRAM_ID`).

## 2. Create the database (MongoDB Atlas, free tier)

1. Sign up at [mongodb.com/atlas](https://www.mongodb.com/atlas), create a free (M0) cluster.
2. Database Access → add a user + password.
3. Network Access → allow access from anywhere (`0.0.0.0/0`) — simplest for PaaS deploys where the outbound IP isn't fixed.
4. Copy the connection string (Connect → Drivers → Node.js) → this is `MONGODB_URI`.

## 3. Configure environment variables

Copy `.env.example` to `.env` and fill in every value. The two secrets (`WEBHOOK_SECRET_PATH` and `WP_BRIDGE_SECRET`) should each be a long random string — generate with:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

`WP_BRIDGE_SECRET` must be entered **identically** in WordPress under **Desi Hub → Settings → Telegram Bot Bridge**.

`VIP_CHANNELS` is a JSON array, e.g.:
```
[{"name":"Desi Hub VIP","chatId":"-1001234567890"}]
```
Add more objects to the array for multiple VIP channels.

## 4. Deploy

### Option A — Render / Koyeb / Heroku (recommended, matches BOT_MODE=webhook)

1. Push this folder to a GitHub repo.
2. Create a new **Web Service** pointing at that repo. Build command `npm install`, start command `npm start`.
3. Add all the `.env` values as environment variables in the platform's dashboard.
4. Set `PUBLIC_URL` to the URL the platform gives your service (e.g. `https://desihub-bot.onrender.com`) — **redeploy once** after you know this URL, since the bot registers its Telegram webhook against it on startup.
5. Free tiers on Render/Koyeb can "sleep" after inactivity — that's fine for webhook mode (Telegram just retries delivery, and it wakes the service up), but be aware the hourly expiry-check cron only runs while the process is awake. For a site actually selling paid memberships, a paid "always-on" tier (or a VPS) is worth it so kicks/reminders fire reliably on time.

### Option B — VPS (DigitalOcean, Hostinger VPS, etc.)

```bash
git clone <your-repo-url> desi-hub-bot
cd desi-hub-bot
npm install
cp .env.example .env   # fill it in; set BOT_MODE=webhook and PUBLIC_URL to your domain, or BOT_MODE=polling if you don't have a domain/SSL
npm install -g pm2
pm2 start src/index.js --name desihub-bot
pm2 save
pm2 startup   # follow the printed instructions so it survives reboots
```

If you use `BOT_MODE=webhook` on a VPS, put it behind Nginx + Certbot (HTTPS is required by Telegram for webhooks) and reverse-proxy to `PORT`.

## 5. Connect WordPress

1. In wp-admin: **Desi Hub → Settings → Telegram Bot Bridge** — enter the bot's deployed URL, the same shared secret as `WP_BRIDGE_SECRET`, and the bot's `@username`.
2. Add the shortcode `[dh_telegram_connect]` to your My Account / membership page — this is the "Connect Telegram" button members tap so the bot knows which Telegram account belongs to which WordPress login.
3. Publish a test comic/story/album and confirm it lands in Telegram for any subscriber who tapped **Yes** on the consent prompt.
4. Do a test purchase (or use the manual/bank-transfer approval path) and confirm the confirmation + bill + VIP link arrive.

## Why this won't get flood-wait'd or banned

- **Broadcasts are rate-limited** (`src/rateLimiter.js`) to a safe ~20 messages/second, well under Telegram's ~30/sec ceiling, with automatic backoff honoring Telegram's own `retry_after` value if a 429 ever occurs.
- **Webhook mode** (the default) means Telegram pushes updates to your bot instead of your bot constantly long-polling Telegram's servers — this is both more efficient and Telegram's own recommended approach for bots with meaningful traffic.
- **VIP invite links are per-user, single-use** (`member_limit: 1`), so there's no link-sharing/abuse pattern that could get the channel or bot flagged.

## Honest limitation: button colors

Telegram's Bot API does not support custom colors on inline keyboard buttons — there's no "make this button green" option in the API itself. The bot uses ⬇️ / 🔴 emoji prefixes on the Download and Get Membership buttons to visually distinguish them, which is the closest equivalent Telegram allows.

## What still needs your input

- `VIP_CHANNELS`, `ADMIN_TELEGRAM_ID`, `BOT_TOKEN`, `MONGODB_URI` — all placeholders in `.env.example`, must be filled in before this runs.
- `WELCOME_LOGO_URL` (optional) — set this to a hosted image URL of your Desi Hub logo if you want it sent with the welcome message.
