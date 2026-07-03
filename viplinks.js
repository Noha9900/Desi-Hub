const { config } = require('../config');
const { InviteLink } = require('../db');

/**
 * Creates ONE single-use invite link per member per VIP channel using
 * Telegram's native `createChatInviteLink` with member_limit: 1, so two
 * people can never join off the same link. The link is set to expire in
 * `vipLinkTtlMs` (2 minutes) and we also actively revoke it right after
 * that window via `revokeChatInviteLink`, so it stops working even if
 * Telegram's own expiry is a few seconds late.
 *
 * Returns [{ name, link }] — one entry per configured VIP channel.
 */
async function issueVipLinks(telegramId, telegram) {
  const expiresAt = new Date(Date.now() + config.vipLinkTtlMs);
  const issued = [];

  for (const channel of config.vipChannels) {
    try {
      const invite = await telegram.createChatInviteLink(channel.chatId, {
        member_limit: 1,
        expire_date: Math.floor(expiresAt.getTime() / 1000),
        name: `member-${telegramId}-${Date.now()}`,
      });

      const doc = await InviteLink.create({
        telegramId,
        chatId: String(channel.chatId),
        channelName: channel.name,
        inviteLink: invite.invite_link,
        expiresAt,
      });

      issued.push({ name: channel.name, link: invite.invite_link });

      // Belt-and-braces: actively revoke shortly after the join window,
      // in addition to Telegram's own expire_date, and in addition to
      // the periodic sweep in expiryCron.js that catches anything missed
      // if the process restarted (Render/Koyeb free tiers can sleep).
      scheduleRevoke(doc._id, channel.chatId, invite.invite_link, telegram, config.vipLinkTtlMs);
    } catch (err) {
      console.error(`[viplinks] Failed to create invite for ${channel.name}:`, err.message);
    }
  }

  return issued;
}

function scheduleRevoke(inviteDocId, chatId, inviteLink, telegram, delayMs) {
  setTimeout(async () => {
    try {
      const doc = await InviteLink.findById(inviteDocId);
      if (!doc || doc.revoked) return;
      await telegram.revokeChatInviteLink(chatId, inviteLink);
      doc.revoked = true;
      await doc.save();
      console.log(`[viplinks] Revoked link for chat ${chatId}`);
    } catch (err) {
      // "link not found" / already-expired errors here are expected and harmless.
      console.warn('[viplinks] Revoke attempt:', err.message);
    }
  }, delayMs + 3000); // small buffer past the official expiry
}

/**
 * Sweep for any invite links whose expiry passed while the process
 * wasn't running (free-tier PaaS dynos can sleep/restart). Called from
 * the cron job on every run.
 */
async function revokeStaleLinks(telegram) {
  const stale = await InviteLink.find({ revoked: false, expiresAt: { $lt: new Date() } });
  for (const doc of stale) {
    try {
      await telegram.revokeChatInviteLink(doc.chatId, doc.inviteLink);
    } catch (err) {
      // Already expired/invalid on Telegram's side — fine, just mark it done locally.
    }
    doc.revoked = true;
    await doc.save();
  }
  if (stale.length) console.log(`[viplinks] Swept ${stale.length} stale invite link(s)`);
}

module.exports = { issueVipLinks, revokeStaleLinks };
