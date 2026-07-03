const express = require('express');
const bot = require('./bot');
const { config } = require('./config');
const { broadcastNewPost } = require('./handlers/broadcast');
const { handlePaymentSuccess } = require('./handlers/payment');
const { ProcessedEvent } = require('./db');

const app = express();
app.use(express.json({ limit: '2mb' }));

/** Every WordPress webhook must send this header, matching WP_BRIDGE_SECRET. Anything else is rejected. */
function verifyWpSecret(req, res, next) {
  const provided = req.get('X-DH-Bridge-Secret');
  if (!provided || provided !== config.wpBridgeSecret) {
    return res.status(401).json({ error: 'Invalid or missing bridge secret' });
  }
  next();
}

/** Skip duplicate deliveries if WordPress retries a webhook (e.g. after a slow response). */
async function isDuplicate(eventId) {
  if (!eventId) return false;
  try {
    await ProcessedEvent.create({ eventId });
    return false;
  } catch (err) {
    if (err.code === 11000) return true; // unique index violation = already processed
    throw err;
  }
}

app.get('/', (_req, res) => res.send('Desi Hub Telegram bridge is running.'));
app.get('/health', (_req, res) => res.json({ ok: true }));

/**
 * Fired from WordPress when a dh_comic / dh_story / dh_album is published.
 * Body: { eventId, postType, title, excerpt, posterUrl, permalink, shortlinkUrl }
 */
app.post('/webhooks/new-post', verifyWpSecret, async (req, res) => {
  const post = req.body;
  if (await isDuplicate(post.eventId)) return res.json({ ok: true, duplicate: true });

  res.json({ ok: true }); // ack immediately so WP doesn't time out waiting on a big broadcast
  broadcastNewPost(post, bot.telegram).catch((err) => console.error('[server] broadcastNewPost failed:', err));
});

/**
 * Fired from WordPress right after `dh_activate_membership()` succeeds.
 * Body: see handlers/payment.js for the exact shape.
 */
app.post('/webhooks/payment-success', verifyWpSecret, async (req, res) => {
  const payload = req.body;
  if (await isDuplicate(payload.eventId)) return res.json({ ok: true, duplicate: true });

  try {
    const result = await handlePaymentSuccess(payload, bot.telegram);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[server] handlePaymentSuccess failed:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** Telegram delivers updates here when BOT_MODE=webhook. */
const telegramWebhookPath = `/telegram/${config.webhookSecretPath}`;
app.use(bot.webhookCallback(telegramWebhookPath));

module.exports = { app, telegramWebhookPath };
