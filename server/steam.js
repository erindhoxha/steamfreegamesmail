const axios = require("axios");

const STORE = "https://store.steampowered.com";
const COUNTRY = "us";

const client = axios.create({
  timeout: 20000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function formatPrice(cents, currency) {
  if (typeof cents !== "number") return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(cents / 100);
}

function formatDeadline(unixSeconds) {
  if (!unixSeconds) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(unixSeconds * 1000));
}

// Steam embeds store item metadata as GStoreItemData.AddStoreItemDataSet({...}) script calls.
// Brace counting has to be string-aware because the payload contains escaped HTML.
function readBalancedObject(text, start) {
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function extractItemDataSets(html) {
  const sets = [];
  const marker = /GStoreItemData\.AddStoreItemDataSet\(\s*/g;
  let match;

  while ((match = marker.exec(html))) {
    const json = readBalancedObject(html, html.indexOf("{", match.index + match[0].length));
    if (!json) continue;
    try {
      sets.push(JSON.parse(json));
    } catch {
      // A single malformed block should not take down the whole run.
    }
  }
  return sets;
}

// Steam's CDN serves every app's header at this path, used when the API has none.
const headerImageUrl = (appId) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;

async function fetchAppDetails(appId) {
  try {
    const { data } = await client.get(`${STORE}/api/appdetails`, {
      params: { appids: appId, cc: COUNTRY, l: "english", filters: "basic,price_overview" },
    });
    const entry = data?.[appId];
    return entry?.success ? entry.data : null;
  } catch {
    return null;
  }
}

async function fetchSpecialsDeadlines() {
  try {
    const { data } = await client.get(`${STORE}/api/featuredcategories`, {
      params: { cc: COUNTRY, l: "english" },
    });
    const deadlines = new Map();
    for (const item of data?.specials?.items || []) {
      if (item.discount_expiration) deadlines.set(String(item.id), item.discount_expiration);
    }
    return deadlines;
  } catch {
    return new Map();
  }
}

// The store page embeds the active discount's end as a unix timestamp (HTML-escaped JSON).
async function fetchStorePageDeadline(appId) {
  try {
    const { data: html } = await client.get(`${STORE}/app/${appId}/`, {
      params: { cc: COUNTRY, l: "english" },
      headers: { Cookie: "birthtime=0; wants_mature_content=1; lastagecheckage=1-0-1970" },
    });
    const match = html.match(/discount_end_date(?:&quot;|"):(\d{9,})/);
    return match ? Number(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

// Games discounted to 100% off. You claim them and keep them permanently.
async function fetchFreeToKeep() {
  const { data } = await client.get(`${STORE}/search/results/`, {
    params: {
      query: "",
      start: 0,
      count: 100,
      maxprice: "free",
      specials: 1,
      cc: COUNTRY,
      l: "english",
      infinite: 1,
      json: 1,
      category1: 998, // games only, no DLC or soundtracks
    },
  });

  const appIds = [
    ...new Set([...String(data?.results_html || "").matchAll(/data-ds-appid="(\d+)"/g)].map((match) => match[1])),
  ];
  if (appIds.length === 0) return [];

  const deadlines = await fetchSpecialsDeadlines();
  const games = [];

  for (const appId of appIds) {
    const details = await fetchAppDetails(appId);
    await sleep(400);
    if (!details) continue;

    // is_free means permanently free-to-play, which is not a giveaway.
    const price = details.price_overview;
    if (details.type !== "game" || details.is_free || !price || price.discount_percent !== 100 || price.final !== 0) continue;

    // featuredcategories only covers featured specials, so fall back to the store page.
    const deadline = formatDeadline(deadlines.get(appId) || (await fetchStorePageDeadline(appId)));
    games.push({
      kind: "keep",
      appId,
      title: details.name,
      image: details.header_image || headerImageUrl(appId),
      description: details.short_description || "",
      url: `${STORE}/app/${appId}/`,
      price: formatPrice(price.initial, price.currency),
      note: deadline ? `Free to keep until ${deadline} UTC` : "Free to keep for a limited time",
    });
  }

  return games;
}

// Temporary play-for-free promotions. The store price does not change, so these
// only surface through the free_weekend flag on the storefront payload.
async function fetchFreeWeekends() {
  const { data: html } = await client.get(`${STORE}/`, {
    params: { cc: COUNTRY, l: "english" },
    headers: { Cookie: "birthtime=0; wants_mature_content=1; lastagecheckage=1-0-1970" },
  });

  const byAppId = new Map();

  for (const set of extractItemDataSets(html)) {
    for (const [appId, app] of Object.entries(set.rgApps || {})) {
      if (!app?.free_weekend || byAppId.has(appId)) continue;
      byAppId.set(appId, {
        kind: "weekend",
        appId,
        title: app.name,
        image: "",
        url: `${STORE}/app/${appId}/`,
        price: "",
        note: app.free_weekend_status || "Free to play this weekend",
      });
    }
  }

  // The storefront payload has no header image for free-weekend apps, so look it up.
  const games = [...byAppId.values()];
  for (const game of games) {
    const details = await fetchAppDetails(game.appId);
    game.image = details?.header_image || headerImageUrl(game.appId);
    await sleep(400);
  }
  return games;
}

module.exports = { fetchFreeToKeep, fetchFreeWeekends };
