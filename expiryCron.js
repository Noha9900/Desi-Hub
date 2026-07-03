const cron = require('node-cron');
const { Subscriber } = require('../db');
const { getMembershipRoster } = require('../wpApi');
const { revokeStaleLinks } = require('./viplinks');
const { config } = require('../config');

/**
 * Removes someone from every configured VIP channel. Telegram has no
 * direct "kick without ban" call — the correct pattern is
 * banChatMember followed immediately by unbanChatMember, which removes
 * them but leaves them free to rejoin later (e.g. if they renew).
 */
async function removeFromVipChannels(telegramId, telegram) {
  for (const channel of config.vipChannels) {
    try {
      await telegram.banChatMember(channel.chatId, telegramId);
      await telegram.unbanChatMember(channel.chatId, telegramId, { only_if_banned: true });
    } catch (err) {
      console.warn(`[expiryCron] Could not remove ${telegramId} from ${channel.name}:`, err.message);
    }
  }
}

async function runExpiryCheck(telegram) {
  console.log('[expiryCron] Running membership expiry check...');

  await revokeStaleLinks(telegram);

  let roster;
  try {
    roster = await getMembershipRoster();
  } catch (err) {
    console.error('[expiryCron] Could not reach WordPress for the membership roster:', err.message);
    return;
  }

  // Expired: kick from VIP channels + send a "renew now" notification, once.
  for (const entry of roster.expired || []) {
    const sub = await Subscriber.findOne({ wpUserId: entry.wpUserId });
    if (!sub) continue;

    if (sub.membership?.isActive) {
      await removeFromVipChannels(sub.telegramId, telegram);
      sub.membership.isActive = false;
    }

    if (!sub.membership?.lastNotifiedExpired) {
      try {
        await telegram.sendMessage(
          sub.telegramId,
          `⏰ Your Desi Hub membership (${sub.membership?.planName || 'your plan'}) has expired and you've been ` +
            `removed from the VIP channel(s).\n\nRenew any time to get instant access back:`,
          {
            reply_markup: {
              inline_keyboard: [[{ text: '🔴 Renew Membership', url: `${config.wpBaseUrl}/membership/` }]],
            },
          }
        );
      } catch (err) {
        console.warn(`[expiryCron] Could not message ${sub.telegramId}:`, err.message);
      }
      sub.membership.lastNotifiedExpired = true;
    }
    await sub.save();
  }

  // Expiring soon (e.g. within 3 days): one reminder, not repeated daily.
  for (const entry of roster.expiringSoon || []) {
    const sub = await Subscriber.findOne({ wpUserId: entry.wpUserId });
    if (!sub || sub.membership?.lastReminderSentAt) continue;

    try {
      const expiresLabel = new Date(entry.expiresAt).toDateString();
      await telegram.sendMessage(
        sub.telegramId,
        `🔔 Reminder: your Desi Hub membership expires on *${expiresLabel}*. Renew before then to avoid losing VIP access.`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔴 Renew Now', url: `${config.wpBaseUrl}/membership/` }]] },
        }
      );
      sub.membership.lastReminderSentAt = new Date();
      await sub.save();
    } catch (err) {
      console.warn(`[expiryCron] Could not remind ${sub.telegramId}:`, err.message);
    }
  }

  console.log(
    `[expiryCron] Done. Expired: ${(roster.expired || []).length}, expiring soon: ${(roster.expiringSoon || []).length}`
  );
}

/** Runs every hour — cheap enough on the free MongoDB/PaaS tiers and catches expiries promptly. */
function startExpiryCron(telegram) {
  cron.schedule('0 * * * *', () => runExpiryCheck(telegram).catch((err) => console.error('[expiryCron] error:', err)));
  console.log('[expiryCron] Scheduled: runs every hour');
}

module.exports = { startExpiryCron, runExpiryCheck };
