const axios = require('axios');
const { config } = require('./config');

const client = axios.create({
  baseURL: `${config.wpBaseUrl}/wp-json/desihub/v1`,
  timeout: 15000,
  headers: { 'X-DH-Bridge-Secret': config.wpBridgeSecret },
});

/** Tell WordPress that this Telegram account now belongs to this wp_user_id. */
async function linkTelegramAccount(wpUserId, telegramId, telegramUsername) {
  const { data } = await client.post('/link-telegram', {
    wp_user_id: wpUserId,
    telegram_id: telegramId,
    telegram_username: telegramUsername || null,
  });
  return data;
}

/** Pull current membership status + plan/expiry for one WP user (used to build the bill / status replies). */
async function getMembershipStatus(wpUserId) {
  const { data } = await client.get('/membership-status', { params: { wp_user_id: wpUserId } });
  return data;
}

/**
 * Ask WordPress for every linked member whose membership has expired
 * since the last check (or is expiring soon, for the reminder), so the
 * cron job knows exactly who to kick / remind without guessing.
 */
async function getMembershipRoster() {
  const { data } = await client.get('/membership-roster');
  return data; // { active: [...], expired: [...], expiringSoon: [...] }
}

/** Last few posts across comics/stories/albums, sent to someone right after they accept consent. */
async function getRecentPosts(limit = 3) {
  const { data } = await client.get('/recent-posts', { params: { limit } });
  return data; // array of { postType, title, excerpt, posterUrl, permalink, shortlinkUrl }
}

module.exports = { linkTelegramAccount, getMembershipStatus, getMembershipRoster, getRecentPosts };
