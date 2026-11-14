require("dotenv").config();

const Mailjet = require("node-mailjet");
const { fetchFreeToKeep, fetchFreeWeekends } = require("./steam");
const { readState, writeState, gameKey } = require("./state");
const { buildSubject, buildHtml, buildText } = require("./email");
const { createDraft, sendReminder, isUrgent, isExpired, nextDigestAt, requireEnv } = require("./draft-digest");

// Free weekends recur for the same game months apart, so a notified game becomes
// eligible again once this window passes.
const SEEN_TTL_DAYS = 45;

// Games whose offer ends before the 17:00 digest get their own draft right away.
// Like the digest, it's only a draft: nothing reaches subscribers until you click Send.
async function draftUrgent(state, now) {
  const urgent = state.pending.filter((g) => isUrgent(g, state, now));
  if (urgent.length === 0) return;

  const digestAt = new Date(nextDigestAt(state, now)).toISOString();
  for (const game of urgent) console.log(`  ! urgent (ends ${new Date(game.endsAt).toISOString()}, digest ${digestAt}): ${game.title}`);

  if (process.env.PREVIEW === "true") return;
  if (!process.env.MJ_APIKEY_PUBLIC || !process.env.MJ_APIKEY_PRIVATE) {
    console.log("no Mailjet keys, leaving urgent games in the digest queue");
    return;
  }

  const mailjet = Mailjet.apiConnect(requireEnv("MJ_APIKEY_PUBLIC"), requireEnv("MJ_APIKEY_PRIVATE"));
  const subject = buildSubject(urgent);
  try {
    const id = await createDraft(mailjet, {
      subject,
      html: buildHtml(urgent),
      text: buildText(urgent),
      games: urgent,
      urgent: true,
    });
    console.log(`created urgent draft ${id} "${subject}"`);
    try {
      await sendReminder(mailjet, { id, subject, games: urgent, urgent: true });
    } catch (error) {
      console.error(`urgent reminder failed: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`);
    }
  } catch (error) {
    // Leave them queued: the next run (30 min) retries, and the digest still has them.
    console.error(`urgent draft failed: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`);
    return;
  }

  // The urgent draft owns these now, so the 17:00 digest skips them.
  const drafted = new Set(urgent.map(gameKey));
  for (const key of drafted) state.seen[key] = now;
  state.pending = state.pending.filter((g) => !drafted.has(gameKey(g)));
}

async function main() {
  const [keep, weekend] = await Promise.all([fetchFreeToKeep(), fetchFreeWeekends()]);
  const found = [...keep, ...weekend];

  const state = readState();
  const now = Date.now();
  const cutoff = now - SEEN_TTL_DAYS * 24 * 60 * 60 * 1000;

  state.seen = Object.fromEntries(Object.entries(state.seen).filter(([, sentAt]) => sentAt > cutoff));

  const queued = new Set(state.pending.map(gameKey));
  const fresh = found.filter((game) => !state.seen[gameKey(game)] && !queued.has(gameKey(game)));

  for (const game of fresh) {
    state.pending.push({ ...game, foundAt: new Date(now).toISOString() });
  }

  // Offers that ended while queued are dropped. Marked seen so they don't come back.
  for (const game of state.pending.filter((g) => isExpired(g, now))) {
    console.log(`  - expired before it was sent: ${game.title}`);
    state.seen[gameKey(game)] = now;
  }
  state.pending = state.pending.filter((g) => !isExpired(g, now));

  console.log(`found ${found.length} (keep: ${keep.length}, weekend: ${weekend.length})`);
  console.log(`newly queued ${fresh.length}, pending digest ${state.pending.length}`);
  for (const game of fresh) console.log(`  + [${game.kind}] ${game.title}`);

  await draftUrgent(state, now);
  writeState(state);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
