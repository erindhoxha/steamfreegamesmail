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

// GitHub often starts scheduled runs hours late, so the gate is "at or after", not "exactly".
function dayIn(timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date()); // YYYY-MM-DD
}

function hourIn(timeZone) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

async function createDraft(mailjet, { subject, html, text, games }) {
  const dateLabel = new Date().toISOString().slice(0, 10);
  const draft = await mailjet.post("campaigndraft", { version: "v3" }).request({
    Locale: "en_US",
    Sender: process.env.MJ_FROM_NAME || "Steam Free Games",
    SenderName: process.env.MJ_FROM_NAME || "Steam Free Games",
    SenderEmail: requireEnv("MJ_FROM_EMAIL"),
    Subject: subject,
    ContactsListID: Number(requireEnv("MJ_CONTACT_LIST_ID")),
    Title: `Steam ${dateLabel}: ${games.map((g) => g.title).join(", ")}`.slice(0, 250),
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
async function sendReminder(mailjet, { id, subject, games }) {
  const to = requireEnv("TEST_RECIPIENT");
  const lines = games.map((g) => `- ${g.title}: ${g.note}`);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  await mailjet.post("send", { version: "v3.1" }).request({
    Messages: [
      {
        From: { Email: requireEnv("MJ_FROM_EMAIL"), Name: "Steam Free Games bot" },
        To: [{ Email: to }],
        Subject: `Review needed: Steam draft ready (${games.length} game${games.length === 1 ? "" : "s"})`,
        TextPart: [
          `A new Steam Free Games Mail draft is waiting in Mailjet. Nothing has been sent to subscribers.`,
          ``,
          `Draft #${id}: "${subject}"`,
          ...lines,
          ``,
          `1. Check the test copy in your inbox.`,
          `2. Open Mailjet > Campaigns > Drafts: ${MAILJET_DRAFTS_URL}`,
          `3. Click Send. Some offers only last a day or two.`,
        ].join("\n"),
        HTMLPart: `<p>A new Steam Free Games Mail draft is waiting in Mailjet. Nothing has been sent to subscribers.</p>
<p><b>Draft #${id}:</b> ${esc(subject)}</p>
<ul>${games.map((g) => `<li><b>${esc(g.title)}</b>: ${esc(g.note)}</li>`).join("")}</ul>
<ol><li>Check the test copy in your inbox.</li><li>Open <a href="${MAILJET_DRAFTS_URL}">Mailjet &rsaquo; Campaigns &rsaquo; Drafts</a>.</li><li>Click <b>Send</b>. Some offers only last a day or two.</li></ol>`,
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

  if (state.pending.length === 0) {
    console.log("skipping: nothing new since the last draft");
    return;
  }

  const games = state.pending;
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

module.exports = { sendReminder };
