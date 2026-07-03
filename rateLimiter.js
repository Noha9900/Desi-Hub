const { config } = require('./config');

/**
 * Sends a batch of Telegram API calls at a safe, steady rate instead of
 * firing them all at once. Telegram's own limit is roughly 30 msgs/sec
 * globally (and ~1/sec per individual chat) — we default to well under
 * that, and on a 429 we honor Telegram's `retry_after` and back off
 * automatically instead of hammering the API and risking a temporary ban.
 *
 * `items` — array of anything
 * `worker(item)` — async function that sends one message
 */
async function sendWithRateLimit(items, worker, { perSecond = config.broadcastMessagesPerSecond } = {}) {
  const delayMs = Math.ceil(1000 / perSecond);
  const results = { sent: 0, failed: 0, errors: [] };

  for (const item of items) {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await worker(item);
        results.sent += 1;
        break;
      } catch (err) {
        const retryAfter = err?.response?.body?.parameters?.retry_after || err?.parameters?.retry_after;
        if (retryAfter && attempt < 3) {
          attempt += 1;
          console.warn(`[rateLimiter] Flood-wait hit, backing off ${retryAfter}s before retrying...`);
          await sleep((retryAfter + 1) * 1000);
          continue; // retry the same item
        }
        results.failed += 1;
        results.errors.push({ item, message: err.message });
        break;
      }
    }
    await sleep(delayMs);
  }

  return results;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { sendWithRateLimit, sleep };
