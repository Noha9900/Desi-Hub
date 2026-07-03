const mongoose = require('mongoose');
const { config } = require('./config');

/**
 * One document per Telegram user who has ever pressed /start.
 *
 * wpUserId is filled in once they tap "Connect Telegram" on the website
 * (account/membership page) which deep-links to t.me/<bot>?start=<token>.
 * Until then we know their Telegram identity but can't tie it to a paying
 * WordPress account yet.
 */
const subscriberSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    username: String,
    firstName: String,
    lastName: String,

    wpUserId: { type: Number, default: null, index: true },

    // Consent flow: null = never answered, true = accepted (Yes), false = stopped (No)
    consent: { type: Boolean, default: null },

    // Membership snapshot, kept in sync from WordPress on every payment
    // webhook and by the daily expiry cron. This is a cache for fast
    // /status replies and for the kick job — WordPress remains the
    // source of truth.
    membership: {
      isActive: { type: Boolean, default: false },
      planName: String,
      expiresAt: Date,
      lastNotifiedExpired: { type: Boolean, default: false },
      lastReminderSentAt: Date,
    },
  },
  { timestamps: true }
);

/**
 * Tracks every single-use VIP invite link we hand out, so the scheduled
 * job knows which links are still "live" and need revoking after the
 * join window closes.
 */
const inviteLinkSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, required: true, index: true },
    chatId: { type: String, required: true },
    channelName: String,
    inviteLink: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    revoked: { type: Boolean, default: false },
    used: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/** Idempotency guard: WordPress may retry a webhook if it doesn't get a fast 200. */
const processedEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  processedAt: { type: Date, default: Date.now },
});

const Subscriber = mongoose.model('Subscriber', subscriberSchema);
const InviteLink = mongoose.model('InviteLink', inviteLinkSchema);
const ProcessedEvent = mongoose.model('ProcessedEvent', processedEventSchema);

async function connectDb() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongodbUri);
  console.log('[db] Connected to MongoDB');
}

module.exports = { connectDb, Subscriber, InviteLink, ProcessedEvent };
