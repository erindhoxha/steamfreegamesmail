// Builds the digest email as HTML. Layout mirrors the Epic newsletter's Mailjet template,
// but is rendered in code because campaign drafts can't use `var:items` loops.

// Steam store palette.
const FONT = "Arial, Helvetica, sans-serif";
const PAGE = "#171a21"; // Steam header navy
const PANEL = "#1b2838"; // Steam store background
const TEXT = "#c7d5e0";
const HEADING = "#ffffff";
const MUTED = "#8f98a0";
const LINK = "#66c0f4";
const BUY = "#5c7e10"; // Steam "Add to cart" green
const PRICE_BG = "#344654";
const PRICE_OLD = "#738895";
const PRICE_NEW = "#beee11";
const DISCOUNT_BG = "#4c6b22";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const withUtm = (url) => `${url}?utm_source=efgm&utm_medium=email&utm_campaign=steam_free`;

function buildSubject(games) {
  const keep = games.filter((g) => g.kind === "keep");
  if (keep.length === games.length) {
    return keep.length === 1 ? `Free on Steam: ${games[0].title}` : `${keep.length} free Steam games to claim`;
  }
  if (keep.length === 0) {
    return games.length === 1 ? `Free weekend on Steam: ${games[0].title}` : `${games.length} Steam games free to play`;
  }
  return `${games.length} free Steam games right now`;
}

const button = (href, label, bg, color) => `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
        <tr><td align="center" bgcolor="${bg}" style="border-radius:2px;background:${bg};">
          <a href="${href}" target="_blank" style="display:inline-block;padding:10px 25px;font-family:${FONT};font-size:13px;color:${color};text-decoration:none;">${label}</a>
        </td></tr>
      </table>`;

const row = (inner, padding = "10px 25px", align = "left") =>
  `\n  <tr><td align="${align}" style="padding:${padding};">${inner}</td></tr>`;

const text = (s, { size = 16, color = TEXT, weight = "normal", extra = "" } = {}) =>
  `<p style="margin:0;font-family:${FONT};font-size:${size}px;font-weight:${weight};color:${color};${extra}">${s}</p>`;

const divider = row(`<div style="border-top:1px solid #2a475e;"></div>`);

// Steam-style price block: [-100%][$19.99 Free]
const priceBlock = (price) => `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td bgcolor="${DISCOUNT_BG}" style="background:${DISCOUNT_BG};padding:6px 8px;font-family:${FONT};font-size:16px;font-weight:bold;color:${PRICE_NEW};">-100%</td>
        <td bgcolor="${PRICE_BG}" style="background:${PRICE_BG};padding:6px 10px;font-family:${FONT};font-size:13px;line-height:15px;">${
          price ? `<span style="color:${PRICE_OLD};text-decoration:line-through;font-size:11px;">${esc(price)}</span><br>` : ""
        }<span style="color:${PRICE_NEW};">Free</span></td>
      </tr></table>`;

function card(game) {
  const href = esc(withUtm(game.url));
  return [
    row(
      `<a href="${href}" target="_blank"><img src="${esc(game.image)}" width="550" alt="${esc(game.title)}" style="display:block;width:100%;max-width:550px;height:auto;border:0;"></a>`,
      "0 25px",
    ),
    row(text(`<a href="${href}" target="_blank" style="color:${HEADING};text-decoration:none;">${esc(game.title)}</a>`, { size: 18, weight: "bold" }), "14px 25px 0"),
    game.description ? row(text(esc(game.description), { color: MUTED }), "10px 25px 0") : "",
    game.kind === "keep" ? row(priceBlock(game.price), "12px 25px 0") : "",
    row(text(esc(game.note), { size: 14, color: game.kind === "keep" ? TEXT : LINK }), "10px 25px 18px"),
    row(button(href, game.kind === "keep" ? "Claim on Steam" : "Play on Steam", BUY, "#ffffff"), "0 25px 40px"),
  ].join("");
}

function section(heading, intro, games) {
  if (games.length === 0) return "";
  return (
    row(text(heading, { size: 24, weight: "bold", color: HEADING }), "28px 25px 10px", "center") +
    row(text(intro, { size: 14, color: MUTED }), "0 25px 24px", "center") +
    games.map(card).join("")
  );
}

function buildHtml(games) {
  const keep = games.filter((g) => g.kind === "keep");
  const weekend = games.filter((g) => g.kind === "weekend");
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>Free Steam games</title></head>
<body style="margin:0;padding:0;background:${PAGE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE}" style="background:${PAGE};"><tr><td align="center" style="padding:24px 0;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${PANEL}" style="width:100%;max-width:600px;background:${PANEL};">${section(
    "Free to keep on Steam",
    "Claim before the offer ends and the game stays in your library forever.",
    keep,
  )}${section("Free to play on Steam", "Play for free during the promotion. You don't keep these games afterwards.", weekend)}${divider}${row(
    text("Support our work by buying me a coffee!", { size: 13 }),
    "10px 25px",
    "center",
  )}${row(button("https://www.buymeacoffee.com/erindhoxha", "Buy me a coffee", "#FFDD00", "#000000"))}${divider}${row(
    text("If you wish to unsubscribe from our newsletter, please click the button below.", { size: 13 }),
    "10px 25px",
    "center",
  )}${row(button("[[UNSUB_LINK_EN]]", "Unsubscribe", "#3d4450", TEXT), "10px 25px 24px")}${row(
    text("Not affiliated with Valve or Steam.", { size: 11, color: MUTED }),
    "0 25px 30px",
    "center",
  )}
</table>
</td></tr></table>
</body></html>
`;
}

function buildText(games) {
  const block = (g) =>
    [g.title, g.description, g.kind === "keep" ? `${g.price ? `${g.price} -> ` : ""}Free` : "", g.note, withUtm(g.url)]
      .filter(Boolean)
      .join("\n");
  const keep = games.filter((g) => g.kind === "keep").map(block);
  const weekend = games.filter((g) => g.kind === "weekend").map(block);
  return [
    keep.length ? `FREE TO KEEP ON STEAM\n\n${keep.join("\n\n")}` : "",
    weekend.length ? `FREE TO PLAY ON STEAM (you don't keep these)\n\n${weekend.join("\n\n")}` : "",
    "Support our work by buying me a coffee: https://www.buymeacoffee.com/erindhoxha",
    "Unsubscribe: [[UNSUB_LINK_EN]]",
  ]
    .filter(Boolean)
    .join("\n\n");
}

module.exports = { buildSubject, buildHtml, buildText };
