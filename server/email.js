// Builds the digest email as HTML, rendered in code because campaign drafts can't use
// `var:items` loops. Same layout as the Epic Free Games Mail email (epic_free_games/email-v2):
// one card per game, small tags, a button, a short P.S. and a plain footer, in Steam colours.
//
// Light is the default (inline styles). Dark mode comes from a prefers-color-scheme
// <style> block, which Apple Mail, iOS Mail and Outlook (mac/iOS) honour.
// Gmail ignores that block and auto-darkens light emails on its own, which looks fine;
// a dark-first email is what Gmail inverts into white, so don't go back to that.

// Colours from steamfreegamesmail.com: Steam navy, Steam text greys, green "Sign up" button.
const LIGHT = {
  page: "#FFFFFF",
  card: "#FFFFFF",
  border: "#E1E6EB",
  ink: "#171A21",
  text: "#2B3640",
  muted: "#6B7785",
  btnBg: "#5F7C27", // site "Sign up" green
  btnText: "#FFFFFF",
  link: "#1F6FB2",
  tagBg: "#EEF1F4",
};

const DARK = {
  page: "#1B2838", // site / Steam store background
  card: "#1F2D3D",
  border: "#2A475E",
  ink: "#FFFFFF",
  text: "#C7D5E0",
  muted: "#8F98A0",
  btnBg: "#5F7C27",
  btnText: "#FFFFFF",
  link: "#66C0F4", // Steam link blue
  tagBg: "#2A3F55",
};

const C = LIGHT;
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const SITE_URL = "https://steamfreegamesmail.com";
const EPIC_URL = "https://epicfreegamesmail.com/?utm_source=sfgm&utm_medium=email&utm_campaign=crosspromo";
const COFFEE_URL = "https://www.buymeacoffee.com/erindhoxha";

const withUtm = (url) => `${url}?utm_source=efgm&utm_medium=email&utm_campaign=steam_free`;

// Each class swaps one colour in dark mode. Outlook's phone apps mark dark mode with
// [data-ogsc] (text colours) and [data-ogsb] (backgrounds), so the rules are repeated for both.
const darkRules = (p = "") => `
  ${p}.bg { background:${DARK.page} !important; }
  ${p}.card { background:${DARK.card} !important; border-color:${DARK.border} !important; }
  ${p}.rule { border-color:${DARK.border} !important; }
  ${p}.ink, ${p}.ink a { color:${DARK.ink} !important; }
  ${p}.txt { color:${DARK.text} !important; }
  ${p}.muted, ${p}.muted a { color:${DARK.muted} !important; }
  ${p}.tag { background:${DARK.tagBg} !important; color:${DARK.text} !important; }
  ${p}.btn { background:${DARK.btnBg} !important; }
  ${p}.btn a { color:${DARK.btnText} !important; }
  ${p}a.link { color:${DARK.link} !important; }`;

const STYLE = `<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {${darkRules()}
  }
  ${darkRules("[data-ogsc] ")}
  ${darkRules("[data-ogsb] ")}
  /* Gmail only (u + .body): keeps white button text white in Gmail's own dark mode.
     The button colour itself is protected by background-image, which Gmail doesn't recolour. */
  u + .body .gm-screen { background:#000; mix-blend-mode:screen; display:inline-block; }
  u + .body .gm-diff { background:#000; mix-blend-mode:difference; display:inline-block; }
  @media (max-width: 480px) { .pad { padding-left:20px !important; padding-right:20px !important; } }
</style>`;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const truncate = (text, max = 170) => {
  if (!text || text.length <= max) return text || "";
  return `${text.slice(0, text.lastIndexOf(" ", max)).replace(/[,.;:]$/, "")}…`;
};

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

const p = (html, { cls = "txt", size = 15, color = C.text, margin = "0 0 12px", extra = "" } = {}) =>
  `<p class="${cls}" style="margin:${margin};font-family:${FONT};font-size:${size}px;line-height:1.55;color:${color};${extra}">${html}</p>`;

const link = (href, label, cls = "link", color = C.link) =>
  `<a class="${cls}" href="${esc(href)}" target="_blank" style="color:${color};text-decoration:underline;text-underline-offset:2px;">${label}</a>`;

const button = (href, label) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td class="btn" bgcolor="${C.btnBg}" style="border-radius:6px;background:${C.btnBg};background-image:linear-gradient(${C.btnBg},${C.btnBg});">
      <a href="${esc(href)}" target="_blank" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;font-weight:600;color:${C.btnText};text-decoration:none;"><span class="gm-screen"><span class="gm-diff">${label}&nbsp;&rarr;</span></span></a>
    </td>
  </tr></table>`;

// Small neutral label (pill).
const tag = (label) =>
  `<span class="tag" style="display:inline-block;padding:3px 8px;border-radius:4px;background:${C.tagBg};font-family:${FONT};font-size:12px;font-weight:600;color:${C.text};">${label}</span>`;

function priceLine(game) {
  if (game.kind !== "keep" || !game.price) return "";
  return p(
    `<span class="muted" style="text-decoration:line-through;color:${C.muted};">${esc(game.price)}</span>&nbsp;&nbsp;<strong class="ink" style="color:${C.ink};">Free</strong>`,
    { margin: "0 0 18px" },
  );
}

function gameCard(game) {
  const href = withUtm(game.url);
  const keep = game.kind === "keep";
  const img = game.image
    ? `<tr><td><a href="${esc(href)}" target="_blank"><img src="${esc(game.image)}" width="552" alt="${esc(game.title)}" style="display:block;width:100%;max-width:552px;height:auto;border:0;border-radius:8px 8px 0 0;"></a></td></tr>`
    : "";
  return `
  <tr><td style="padding:0 0 20px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="card" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.border};border-radius:8px;">
      ${img}
      <tr><td class="pad" style="padding:20px 24px 24px;">
        <p style="margin:0 0 10px;">${tag(keep ? "Free to keep" : "Free weekend")}</p>
        ${p(esc(game.title), { cls: "ink", size: 20, color: C.ink, margin: "0 0 4px", extra: "font-weight:700;line-height:1.3;" })}
        ${p(esc(game.note), { cls: "muted", size: 14, color: C.muted, margin: "0 0 12px" })}
        ${game.description ? p(esc(truncate(game.description)), { margin: "0 0 16px" }) : ""}
        ${priceLine(game)}
        ${button(href, keep ? "Claim on Steam" : "Play on Steam")}
      </td></tr>
    </table>
  </td></tr>`;
}

function heading(games) {
  const keep = games.filter((g) => g.kind === "keep").length;
  if (keep === games.length) {
    return ["Free to keep on Steam", "Claim before the offer ends and the game stays in your library."];
  }
  if (keep === 0) {
    return ["Free to play on Steam", "Play for free during the promotion. You don't keep these games afterwards."];
  }
  return ["Free on Steam right now", "Some are yours to keep, others are free to play for a limited time."];
}

const psNote = () => `
  <tr><td style="padding:12px 4px 8px;">
    ${p(`<strong class="ink" style="color:${C.ink};">P.S.</strong> I also run an Epic version that emails you the free Epic Games Store games every Thursday. ${link(EPIC_URL, "Sign up here")} if you play on Epic too.`, { margin: "0 0 14px" })}
    ${p(`If these emails save you some money, you can ${link(COFFEE_URL, "buy me a coffee")}. Thanks for reading!`, { margin: "0 0 4px" })}
    ${p("Erind", { cls: "ink", color: C.ink, margin: "0", extra: "font-weight:600;" })}
  </td></tr>`;

const footer = () => `
  <tr><td style="padding:24px 4px 0;"><div class="rule" style="border-top:1px solid ${C.border};font-size:0;line-height:0;">&nbsp;</div></td></tr>
  <tr><td style="padding:16px 4px 0;">
    ${p(`You're getting this because you signed up at ${link(SITE_URL, "steamfreegamesmail.com", "muted", C.muted)}.`, { cls: "muted", size: 12, color: C.muted, margin: "0 0 4px" })}
    ${p(link("[[UNSUB_LINK_EN]]", "Unsubscribe", "muted", C.muted), { cls: "muted", size: 12, color: C.muted, margin: "0 0 4px" })}
    ${p("Not affiliated with Valve or Steam.", { cls: "muted", size: 12, color: C.muted, margin: "0" })}
  </td></tr>`;

function buildHtml(games) {
  // Free-to-keep games first: they're the better deal.
  const ordered = [...games.filter((g) => g.kind === "keep"), ...games.filter((g) => g.kind !== "keep")];
  const [title, intro] = heading(games);
  const preheader = `${title}: ${games.map((g) => g.title).join(", ")}`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>Steam Free Games Mail</title>
${STYLE}
</head>
<body class="body bg" style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" bgcolor="${C.page}" style="background:${C.page};"><tr><td align="center" style="padding:32px 16px 40px;">
  <table role="presentation" width="552" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:552px;">
    <tr><td style="padding:0 4px 24px;">
      ${p("Steam Free Games Mail", { cls: "muted", size: 13, color: C.muted, margin: "0 0 14px", extra: "font-weight:600;" })}
      ${p(esc(title), { cls: "ink", size: 26, color: C.ink, margin: "0 0 8px", extra: "font-weight:700;line-height:1.25;letter-spacing:-0.3px;" })}
      ${p(esc(intro), { cls: "muted", color: C.muted, margin: "0" })}
    </td></tr>
    ${ordered.map(gameCard).join("")}
    ${psNote()}
    ${footer()}
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
    `P.S. I also run an Epic version that emails you the free Epic Games Store games every Thursday:\n${EPIC_URL}`,
    `Buy me a coffee: ${COFFEE_URL}\nErind`,
    "Unsubscribe: [[UNSUB_LINK_EN]]",
  ]
    .filter(Boolean)
    .join("\n\n");
}

module.exports = { buildSubject, buildHtml, buildText };
