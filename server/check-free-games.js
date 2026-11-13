require("dotenv").config();

const { fetchFreeToKeep, fetchFreeWeekends } = require("./steam");
const { readState, writeState, gameKey } = require("./state");

// Free weekends recur for the same game months apart, so a notified game becomes
// eligible again once this window passes.
const SEEN_TTL_DAYS = 45;

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

  writeState(state);

  console.log(`found ${found.length} (keep: ${keep.length}, weekend: ${weekend.length})`);
  console.log(`newly queued ${fresh.length}, pending digest ${state.pending.length}`);
  for (const game of fresh) console.log(`  + [${game.kind}] ${game.title}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
