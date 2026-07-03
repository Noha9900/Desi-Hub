require('dotenv').config();

function parseVipChannels(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('VIP_CHANNELS must be a JSON array');
    return parsed;
  } catch (err) {
    console.error('[config] Could not parse VIP_CHANNELS env var. Expected JSON like ' +
      '[{"name":"Desi Hub VIP","chatId":"-100123..."}]. Error:', err.message);
    return [];
  }
}

const config = {
  botToken: process.env.BOT_TOKEN,
  botMode: (process.env.BOT_MODE || 'webhook').toLowerCase(), // 'webhook' | 'polling'
  publicUrl: process.env.PUBLIC_URL,
  webhookSecretPath: process.env.WEBHOOK_SECRET_PATH || 'webhook',
  adminTelegramId: process.env.ADMIN_TELEGRAM_ID ? Number(process.env.ADMIN_TELEGRAM_ID) : null,
  vipChannels: parseVipChannels(process.env.VIP_CHANNELS),

  mongodbUri: process.env.MONGODB_URI,

  wpBaseUrl: (process.env.WP_BASE_URL || '').replace(/\/+$/, ''),
  wpBridgeSecret: process.env.WP_BRIDGE_SECRET,

  port: Number(process.env.PORT) || 3000,

  // How long a per-member VIP invite link stays valid before it is
  // auto-revoked, per the "join within 2 minutes" requirement.
  vipLinkTtlMs: 2 * 60 * 1000,

  // Telegram allows roughly 30 messages/second across different chats.
  // We stay well under that so a big broadcast never triggers a 429
  // flood-wait or gets the bot rate-limited/banned.
  broadcastMessagesPerSecond: 20,
};

function assertRequiredConfig() {
  const missing = [];
  if (!config.botToken) missing.push('BOT_TOKEN');
  if (!config.mongodbUri) missing.push('MONGODB_URI');
  if (!config.wpBaseUrl) missing.push('WP_BASE_URL');
  if (!config.wpBridgeSecret) missing.push('WP_BRIDGE_SECRET');
  if (config.botMode === 'webhook' && !config.publicUrl) missing.push('PUBLIC_URL (required when BOT_MODE=webhook)');

  if (missing.length) {
    console.error('[config] Missing required environment variables:\n  - ' + missing.join('\n  - '));
    console.error('[config] Copy .env.example to .env and fill these in before starting the bot.');
    process.exit(1);
  }
}

module.exports = { config, assertRequiredConfig };
