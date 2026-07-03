const { config, assertRequiredConfig } = require('./config');
const { connectDb } = require('./db');
const bot = require('./bot');
const { startExpiryCron } = require('./handlers/expiryCron');

async function main() {
  assertRequiredConfig();
  await connectDb();

  const { app, telegramWebhookPath } = require('./server');

  if (config.botMode === 'webhook') {
    const webhookUrl = `${config.publicUrl}${telegramWebhookPath}`;
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`[bot] Webhook mode — Telegram will push updates to ${webhookUrl}`);
  } else {
    await bot.telegram.deleteWebhook().catch(() => {});
    bot.launch();
    console.log('[bot] Polling mode started');
  }

  app.listen(config.port, () => {
    console.log(`[server] Listening on port ${config.port}`);
  });

  startExpiryCron(bot.telegram);

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  function shutdown(signal) {
    console.log(`[bot] Received ${signal}, shutting down...`);
    if (config.botMode === 'polling') bot.stop(signal);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('[bot] Fatal startup error:', err);
  process.exit(1);
});
