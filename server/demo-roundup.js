// Steam Next Fest roundup: a few free demos in one email. Run by hand during Next Fest
// (February, June and October). Like the digest it only makes a Mailjet draft plus a
// test copy, and it doesn't touch the daily queue.
//
//   node server/demo-roundup.js                    top 5 demos from Steam's list
//   DEMO_COUNT=6 node server/demo-roundup.js       how many demos
//   DEMO_APPIDS=123,456 node server/demo-roundup.js  hand-picked demo or full game IDs
//   PREVIEW=true node server/demo-roundup.js       write preview.html, no Mailjet calls

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const Mailjet = require("node-mailjet");
const { fetchDemos } = require("./demos");
const { buildSubject, buildHtml, buildText } = require("./email");
const { createDraft, sendReminder, requireEnv } = require("./draft-digest");

async function main() {
  const limit = Number(process.env.DEMO_COUNT) || 5;
  const appIds = String(process.env.DEMO_APPIDS || "")
    .split(/[\s,]+/)
    .filter((id) => /^\d+$/.test(id));

  const demos = await fetchDemos({ limit, appIds });
  if (demos.length === 0) throw new Error("no demos found");

  const subject = buildSubject(demos);
  const html = buildHtml(demos);
  const text = buildText(demos);
  console.log(`subject: ${subject}`);
  for (const d of demos) console.log(`  + ${d.title} (${d.url})`);

  if (process.env.PREVIEW === "true") {
    const file = path.join(__dirname, "..", "preview.html");
    fs.writeFileSync(file, html);
    console.log(`preview written to ${file}`);
    return;
  }

  const mailjet = Mailjet.apiConnect(requireEnv("MJ_APIKEY_PUBLIC"), requireEnv("MJ_APIKEY_PRIVATE"));
  const id = await createDraft(mailjet, { subject, html, text, games: demos });
  console.log(`created draft ${id}, test sent to ${process.env.TEST_RECIPIENT}`);
  try {
    await sendReminder(mailjet, { id, subject, games: demos });
  } catch (error) {
    console.error(`reminder failed: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`);
  }
}

main().catch((error) => {
  console.error(error.response?.data ? JSON.stringify(error.response.data) : error.message);
  process.exit(1);
});
