const { Telegraf, Markup } = require('telegraf');
const { config } = require('./config');
const { Subscriber } = require('./db');
const { linkTelegramAccount } = require('./wpApi');
const { sendRecentPosts } = require('./handlers/broadcast');

const bot = new Telegraf(config.botToken);

const WELCOME_LOGO_URL = process.env.WELCOME_LOGO_URL || null; // optional: set to a hosted PNG/JPG of the Desi Hub logo

const CONSENT_TEXT =
  'This bot is owned and operated by *Desi Hub* and Desi Hub retains full rights over its operation.\n\n' +
  'By using this bot you agree to be a subscriber of Desi Hub and will receive notifications and new posts ' +
  '(comics, stories and albums) from the site.\n\n' +
  'Tap *Yes* to accept and start receiving updates, or *No* to stop.';

function consentKeyboard(accepted) {
  return Markup.inlineKeyboard([
    Markup.button.callback(accepted === true ? '✅ Accepted' : 'Yes', 'consent_yes'),
    Markup.button.callback(accepted === false ? '🛑 Stopped' : 'No', 'consent_no'),
  ]);
}

/** Find-or-create a Subscriber doc for whoever just messaged the bot. */
async function upsertSubscriber(ctx) {
  const from = ctx.from;
  return Subscriber.findOneAndUpdate(
    { telegramId: from.id },
    {
      $setOnInsert: { telegramId: from.id },
      $set: {
        username: from.username || null,
        firstName: from.first_name || null,
        lastName: from.last_name || null,
      },
    },
    { upsert: true, new: true }
  );
}

bot.start(async (ctx) => {
  const sub = await upsertSubscriber(ctx);

  // Deep link from the website: t.me/<bot>?start=<wpUserId>.<signedToken>
  // See class-telegram-bridge.php for how the token is generated/verified.
  const payload = ctx.startPayload;
  if (payload) {
    try {
      const [wpUserId] = payload.split('.');
      await linkTelegramAccount(Number(wpUserId), ctx.from.id, ctx.from.username);
      sub.wpUserId = Number(wpUserId);
      await sub.save();
      await ctx.reply('✅ Your Telegram account is now linked to your Desi Hub website account.');
    } catch (err) {
      console.error('[bot] link-telegram failed:', err.message);
      // Non-fatal — they can still use the bot, just retry connecting later from the account page.
    }
  }

  if (WELCOME_LOGO_URL) {
    await ctx.replyWithPhoto(WELCOME_LOGO_URL).catch(() => {});
  }

  await ctx.replyWithMarkdown(
    `👋 *Welcome to Desi Hub!*\n\nComics, stories and albums — with instant Telegram delivery for members.\n\n${CONSENT_TEXT}`,
    consentKeyboard(sub.consent)
  );
});

bot.action('consent_yes', async (ctx) => {
  await Subscriber.updateOne({ telegramId: ctx.from.id }, { $set: { consent: true } });
  await ctx.editMessageReplyMarkup(consentKeyboard(true).reply_markup);
  await ctx.answerCbQuery('Subscribed!');
  await ctx.reply(
    "🎉 You're in! You'll now get every new comic, story and album we post, plus membership updates.\n\n" +
      'Here are a few recent posts to catch up on:'
  );
  await sendRecentPosts(ctx.from.id, bot.telegram);
});

bot.action('consent_no', async (ctx) => {
  await Subscriber.updateOne({ telegramId: ctx.from.id }, { $set: { consent: false } });
  await ctx.editMessageReplyMarkup(consentKeyboard(false).reply_markup);
  await ctx.answerCbQuery('Stopped');
  await ctx.reply("You won't receive any posts or notifications. Send /start any time to change your mind.");
});

bot.command('membership', async (ctx) => {
  const sub = await Subscriber.findOne({ telegramId: ctx.from.id });
  if (!sub || !sub.wpUserId) {
    return ctx.reply(
      'Your Telegram isn\'t linked to a Desi Hub account yet. Log in on the website, open your Account page, ' +
        'and tap "Connect Telegram" — it\'ll bring you right back here.'
    );
  }
  if (sub.membership?.isActive) {
    const exp = sub.membership.expiresAt ? new Date(sub.membership.expiresAt).toDateString() : 'unknown';
    return ctx.reply(`✅ Active — ${sub.membership.planName || 'Membership'}\nExpires: ${exp}`);
  }
  return ctx.reply('You don\'t have an active membership right now. Use /join to see plans.');
});

bot.command('join', async (ctx) => {
  await ctx.reply(
    'Get instant direct downloads + VIP Telegram channel access:',
    Markup.inlineKeyboard([Markup.button.url('🔴 Get Membership', `${config.wpBaseUrl}/membership/`)])
  );
});

module.exports = bot;
