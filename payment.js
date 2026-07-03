const { Subscriber } = require('../db');
const { issueVipLinks } = require('./viplinks');
const { config } = require('../config');

/**
 * Payload shape sent by WordPress's `dh_activate_membership()` hook
 * (see class-telegram-bridge.php):
 * {
 *   wpUserId, username, email,
 *   planName, amount, currency, durationDays,
 *   purchasedAt (ISO), expiresAt (ISO)
 * }
 */
async function handlePaymentSuccess(payload, telegram) {
  const sub = await Subscriber.findOne({ wpUserId: payload.wpUserId });

  if (!sub) {
    // They paid but never connected Telegram — nothing we can DM. Tell the admin so they can follow up.
    if (config.adminTelegramId) {
      await telegram.sendMessage(
        config.adminTelegramId,
        `⚠️ Payment received for ${payload.username} (${payload.email}) but their Telegram isn't linked yet — ` +
          `they won't get VIP links until they connect it from their Account page.`
      );
    }
    return { delivered: false, reason: 'not_linked' };
  }

  sub.membership = {
    isActive: true,
    planName: payload.planName,
    expiresAt: new Date(payload.expiresAt),
    lastNotifiedExpired: false,
    lastReminderSentAt: null,
  };
  await sub.save();

  const expiresLabel = new Date(payload.expiresAt).toDateString();

  // 1) Confirmation
  await telegram.sendMessage(
    sub.telegramId,
    `✅ *Payment Confirmed*\n\nYou are now a *Premium Member* of Desi Hub! 🎉`,
    { parse_mode: 'Markdown' }
  );

  // 2) Bill
  const bill =
    `🧾 *Desi Hub — Membership Receipt*\n\n` +
    `Plan: ${payload.planName}\n` +
    `Amount: ${payload.currency} ${payload.amount}\n` +
    `Duration: ${payload.durationDays} days\n` +
    `Purchased: ${new Date(payload.purchasedAt).toDateString()}\n` +
    `Expires: ${expiresLabel}\n\n` +
    `We'll remind you before this expires so your access never lapses unexpectedly.`;
  await telegram.sendMessage(sub.telegramId, bill, { parse_mode: 'Markdown' });

  // 3) VIP links — one single-use, self-destructing link per configured channel
  const links = await issueVipLinks(sub.telegramId, telegram);
  if (links.length === 1) {
    await telegram.sendMessage(
      sub.telegramId,
      `🔗 Your VIP channel invite (for you only — this link expires in 2 minutes):\n${links[0].link}`
    );
  } else if (links.length > 1) {
    const lines = links.map((l) => `• *${l.name}*: ${l.link}`).join('\n');
    await telegram.sendMessage(
      sub.telegramId,
      `🔗 Your VIP channel invites (for you only — each expires in 2 minutes):\n\n${lines}`,
      { parse_mode: 'Markdown' }
    );
  } else {
    await telegram.sendMessage(
      sub.telegramId,
      'Your membership is active, but no VIP channel is configured yet — contact the admin if this looks wrong.'
    );
  }

  // 4) Admin notification with full purchase details
  if (config.adminTelegramId) {
    const joined = new Date(payload.purchasedAt);
    await telegram.sendMessage(
      config.adminTelegramId,
      `💰 *New membership purchase*\n\n` +
        `User: ${payload.username} (@${sub.username || 'no-username'})\n` +
        `Telegram ID: ${sub.telegramId}\n` +
        `Plan: ${payload.planName}\n` +
        `Amount: ${payload.currency} ${payload.amount}\n` +
        `Joined: ${joined.toLocaleDateString()} ${joined.getFullYear()}\n` +
        `Expiry: ${expiresLabel}\n` +
        `Status: ✅ Confirmed by Desi Hub`,
      { parse_mode: 'Markdown' }
    );
  }

  return { delivered: true };
}

module.exports = { handlePaymentSuccess };
