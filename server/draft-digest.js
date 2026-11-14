// Turns the pending queue into a Mailjet campaign draft and sends a test copy for review.
// Nothing reaches subscribers until you open the draft in Mailjet and click Send.
//
//   node server/draft-digest.js            first run at/after 17:00 Europe/Berlin, once per day
//   FORCE_SEND=true node ...               ignore the time gate
//   PREVIEW=true node ...                  write preview.html, no Mailjet calls, queue untouched

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const Mailjet = require("node-mailjet");
const { readState, writeState, gameKey } = require("./state");
const { buildSubject, buildHtml, buildText } = require("./email");

const SEND_TIMEZONE = "Europe/Berlin";
const SEND_HOUR = 17;

// An offer that ends before the next digest plus this buffer gets its own urgent draft.
// The buffer covers GitHub starting the digest run late and the time it takes you to click Send.
const URGENT_BUFFER_MS = 6 * 60 * 60 * 1000;

// GitHub often starts scheduled runs hours late, so the gate is "at or after", not "exactly".
function dayIn(timeZone, at = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(at)); // YYYY-MM-DD
}

function hourIn(timeZone, at = Date.now()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(new Date(at)));
}

// UTC ms for a wall-clock time in a time zone (handles summer/winter time).
function zonedTime(year, month, day, hour, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(guess))
      .map((part) => [part.type, part.value]),
  );
  const shown = Date.UTC(+parts.year, parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return guess - (shown - guess);
}

// When the next digest is due: today at 17:00 if today's isn't made yet (or now, if it's
// already past 17:00 and the run is late), otherwise tomorrow at 17:00.
function nextDigestAt(state, now = Date.now()) {
  const today = dayIn(SEND_TIMEZONE, now);
  const [y, m, d] = today.split("-").map(Number);
  if (state.lastDraftDay !== today) return Math.max(now, zonedTime(y, m, d, SEND_HOUR, SEND_TIMEZONE));
  return zonedTime(y, m, d + 1, SEND_HOUR, SEND_TIMEZONE);
}

const isExpired = (game, now = Date.now()) => Boolean(game.endsAt) && game.endsAt <= now;

const isUrgent = (game, state, now = Date.now()) =>
  Boolean(game.endsAt) && !isExpired(game, now) && game.endsAt <= nextDigestAt(state, now) + URGENT_BUFFER_MS;

function hoursLeft(games, now = Date.now()) {
  const ends = games.map((g) => g.endsAt).filter(Boolean);
  if (ends.length === 0) return "";
  const hours = Math.max(0, Math.floor((Math.min(...ends) - now) / 3600000));
  return hours < 1 ? "ends in under 1h" : `ends in ${hours}h`;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

async function createDraft(mailjet, { subject, html, text, games, urgent = false }) {
  const dateLabel = new Date().toISOString().slice(0, 10);
  const draft = await mailjet.post("campaigndraft", { version: "v3" }).request({
    Locale: "en_US",
    Sender: process.env.MJ_FROM_NAME || "Steam Free Games",
    SenderName: process.env.MJ_FROM_NAME || "Steam Free Games",
    SenderEmail: requireEnv("MJ_FROM_EMAIL"),
    Subject: subject,
    ContactsListID: Number(requireEnv("MJ_CONTACT_LIST_ID")),
    Title: `${urgent ? "URGENT " : ""}Steam ${dateLabel}: ${games.map((g) => g.title).join(", ")}`.slice(0, 250),
  });
  const id = draft.body.Data[0].ID;

  await mailjet
    .post("campaigndraft", { version: "v3" })
    .id(id)
    .action("detailcontent")
    .request({ "Html-part": html, "Text-part": text });

  await mailjet
    .post("campaigndraft", { version: "v3" })
    .id(id)
    .action("test")
    .request({ Recipients: [{ Email: requireEnv("TEST_RECIPIENT"), Name: "Review" }] });

  return id;
}

const MAILJET_DRAFTS_URL = "https://app.mailjet.com/campaigns";

// A plain nudge, separate from the test copy, so a waiting draft doesn't get missed.
async function sendReminder(mailjet, { id, subject, games, urgent = false }) {
  const to = requireEnv("TEST_RECIPIENT");
  const lines = games.map((g) => `- ${g.title}: ${g.note}`);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  await mailjet.post("send", { version: "v3.1" }).request({
    Messages: [
      {
        From: { Email: requireEnv("MJ_FROM_EMAIL"), Name: "Steam Free Games bot" },
        To: [{ Email: to }],
        Subject: urgent
          ? `URGENT: Steam draft ready, ${hoursLeft(games) || "ends before the digest"}`
          : `Review needed: Steam draft ready (${games.length} game${games.length === 1 ? "" : "s"})`,
        TextPart: [
          `A new Steam Free Games Mail draft is waiting in Mailjet. Nothing has been sent to subscribers.`,
          ...(urgent ? [``, `This offer ends before the 17:00 digest, so it has its own draft.`] : []),
          ``,
          `Draft #${id}: "${subject}"`,
          ...lines,
          ``,
          `1. Check the test copy in your inbox.`,
          `2. Open Mailjet > Campaigns > Drafts: ${MAILJET_DRAFTS_URL}`,
          urgent ? `3. Click Send now, before the offer ends.` : `3. Click Send. Some offers only last a day or two.`,
        ].join("\n"),
        HTMLPart: `<p>A new Steam Free Games Mail draft is waiting in Mailjet. Nothing has been sent to subscribers.</p>
${urgent ? "<p><b>This offer ends before the 17:00 digest, so it has its own draft.</b></p>" : ""}
<p><b>Draft #${id}:</b> ${esc(subject)}</p>
<ul>${games.map((g) => `<li><b>${esc(g.title)}</b>: ${esc(g.note)}</li>`).join("")}</ul>
<ol><li>Check the test copy in your inbox.</li><li>Open <a href="${MAILJET_DRAFTS_URL}">Mailjet &rsaquo; Campaigns &rsaquo; Drafts</a>.</li><li>${urgent ? "Click <b>Send</b> now, before the offer ends." : "Click <b>Send</b>. Some offers only last a day or two."}</li></ol>`,
      },
    ],
  });
  return to;
}

async function main() {
  const preview = process.env.PREVIEW === "true";
  const forced = preview || process.env.FORCE_SEND === "true";
  const localHour = hourIn(SEND_TIMEZONE);
  const today = dayIn(SEND_TIMEZONE);
  const state = readState();

  if (!forced && localHour < SEND_HOUR) {
    console.log(`skipping: ${localHour}:00 in ${SEND_TIMEZONE}, drafts are made from ${SEND_HOUR}:00`);
    return;
  }
  if (!forced && state.lastDraftDay === today) {
    console.log(`skipping: already made today's draft (${today})`);
    return;
  }

  // Don't email games whose offer has already ended.
  const expired = state.pending.filter((g) => isExpired(g));
  if (expired.length > 0) {
    for (const game of expired) console.log(`  - dropped expired: ${game.title}`);
    if (!preview) {
      state.pending = state.pending.filter((g) => !isExpired(g));
      writeState(state);
    }
  }
  const pending = state.pending.filter((g) => !isExpired(g));

  if (pending.length === 0) {
    console.log("skipping: nothing new since the last draft");
    return;
  }

  const games = pending;
  const subject = buildSubject(games);
  const html = buildHtml(games);
  const text = buildText(games);

  if (preview) {
    const file = path.join(__dirname, "..", "preview.html");
    fs.writeFileSync(file, html);
    console.log(`subject: ${subject}\npreview written to ${file}`);
    return;
  }

  const mailjet = Mailjet.apiConnect(requireEnv("MJ_APIKEY_PUBLIC"), requireEnv("MJ_APIKEY_PRIVATE"));
  const id = await createDraft(mailjet, { subject, html, text, games });
  console.log(`created draft ${id} "${subject}" with ${games.length} game(s), test sent to ${process.env.TEST_RECIPIENT}`);

  try {
    const to = await sendReminder(mailjet, { id, subject, games });
    console.log(`reminder sent to ${to}`);
  } catch (error) {
    // The draft exists either way, so don't fail the run over the reminder.
    console.error(`reminder failed: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`);
  }

  // The draft now owns these games. Mark them seen so the next run doesn't draft them again.
  const draftedAt = Date.now();
  for (const game of games) state.seen[gameKey(game)] = draftedAt;
  state.pending = [];
  state.lastDraftDay = today;
  writeState(state);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.response?.data ? JSON.stringify(error.response.data) : error.message);
    process.exit(1);
  });
}

module.exports = { createDraft, sendReminder, isUrgent, isExpired, nextDigestAt, requireEnv };
