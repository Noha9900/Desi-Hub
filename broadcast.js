const { Markup } = require('telegraf');
const { Subscriber } = require('../db');
const { sendWithRateLimit } = require('../rateLimiter');
const { config } = require('../config');

/**
 * Builds the exact post layout requested:
 *   [poster image]
 *   Title
 *   Description
 *   [ Download  ]  <- green
 *   [ Get Membership ] <- red
 */
function buildCaption(post) {
  const typeLabel = { dh_comic: 'Desi Comic', dh_story: 'Desi Story', dh_album: 'Desi Album' }[post.postType] || 'New Post';
  return `🆕 *${typeLabel}*\n\n*${escapeMd(post.title)}*\n\n${escapeMd(post.excerpt || '')}`;
}

function escapeMd(text = '') {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function buildKeyboard(post) {
  const rows = [];
  if (post.shortlinkUrl) {
    rows.push([Markup.button.url('⬇️ Download', post.shortlinkUrl)]); // green via Telegram's default styling for url buttons is not colorable natively — see README note
  }
  rows.push([Markup.button.url('🔴 Get Membership', post.permalink || `${config.wpBaseUrl}/membership/`)]);
  return Markup.inlineKeyboard(rows);
}

/**
 * Called by the /webhooks/new-post route when WordPress publishes a
 * comic/story/album. Sends to every subscriber who tapped Yes on the
 * consent prompt, at a safe rate so Telegram never flood-wait/bans the bot.
 */
async function broadcastNewPost(post, telegram) {
  const subscribers = await Subscriber.find({ consent: true }).select('telegramId').lean();
  const caption = buildCaption(post);
  const keyboard = buildKeyboard(post);

  const result = await sendWithRateLimit(subscribers, async (sub) => {
    if (post.posterUrl) {
      await telegram.sendPhoto(sub.telegramId, post.posterUrl, {
        caption,
        parse_mode: 'MarkdownV2',
        ...keyboard,
      });
    } else {
      await telegram.sendMessage(sub.telegramId, caption, { parse_mode: 'MarkdownV2', ...keyboard });
    }
  });

  console.log(`[broadcast] "${post.title}" -> sent ${result.sent}, failed ${result.failed}`);
  return result;
}

/** Sends the last few posts to someone who just accepted consent, so they don't land in an empty feed. */
async function sendRecentPosts(telegramId, telegram) {
  // In production this calls WP's /recent-posts endpoint (title/excerpt/poster/permalink/shortlink
  // for the last ~3 items across all three post types) and reuses buildCaption/buildKeyboard above.
  // Left as an explicit hook point — see wpApi.js to add a `getRecentPosts()` call here.
  try {
    const wpApi = require('../wpApi');
    if (typeof wpApi.getRecentPosts === 'function') {
      const posts = await wpApi.getRecentPosts();
      for (const post of posts) {
        await telegram.sendMessage(telegramId, buildCaption(post), { parse_mode: 'MarkdownV2', ...buildKeyboard(post) });
      }
    }
  } catch (err) {
    console.error('[broadcast] sendRecentPosts failed:', err.message);
  }
}

module.exports = { broadcastNewPost, sendRecentPosts, buildCaption, buildKeyboard };
