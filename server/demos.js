// Free demos, for the occasional Steam Next Fest roundup. Not part of the daily digest:
// Steam has tens of thousands of demos, so these only go out as a hand-reviewed roundup.
const axios = require("axios");

const STORE = "https://store.steampowered.com";
const client = axios.create({
  timeout: 20000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  },
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const headerImageUrl = (appId) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;

async function appDetails(appId) {
  try {
    const { data } = await client.get(`${STORE}/api/appdetails`, {
      params: { appids: appId, cc: "us", l: "english", filters: "basic,release_date" },
    });
    return data?.[appId]?.success ? data[appId].data : null;
  } catch {
    return null;
  }
}

// Demo app IDs in Steam's own search order, which favours popular and featured demos
// (during Next Fest that's mostly festival demos).
async function topDemoIds(limit) {
  const { data } = await client.get(`${STORE}/search/results/`, {
    params: { query: "", start: 0, count: 50, category1: 10, cc: "us", l: "english", infinite: 1, json: 1 },
  });
  const ids = [...String(data?.results_html || "").matchAll(/data-ds-appid="(\d+)"/g)].map((m) => m[1]);
  return [...new Set(ids)].slice(0, limit * 3); // extra, some get skipped below
}

async function demoFromId(appId) {
  const demo = await appDetails(appId);
  await sleep(400);
  if (!demo || demo.type !== "demo") return null;

  // Link to the full game: its page has the "Download demo" button and the wishlist button.
  const fullId = demo.fullgame?.appid ? String(demo.fullgame.appid) : "";
  const full = fullId ? await appDetails(fullId) : null;
  if (fullId) await sleep(400);

  const title = full?.name || demo.fullgame?.name || demo.name.replace(/\s*[-:]?\s*demo$/i, "");
  const comingSoon = full?.release_date?.coming_soon;
  return {
    kind: "demo",
    appId: fullId || appId,
    title,
    image: full?.header_image || demo.header_image || headerImageUrl(fullId || appId),
    description: full?.short_description || demo.short_description || "",
    url: `${STORE}/app/${fullId || appId}/`,
    price: "",
    note: comingSoon === true ? "Full game coming soon" : comingSoon === false ? "Full game out now" : "Demo on Steam",
  };
}

// appIds: hand-picked demo (or full game) IDs. Without them, takes the top of Steam's list.
async function fetchDemos({ limit = 5, appIds = [] } = {}) {
  const candidates = appIds.length ? appIds : await topDemoIds(limit);
  const demos = [];
  for (const id of candidates) {
    if (demos.length >= limit) break;
    let demo = await demoFromId(id);
    if (!demo && appIds.length) {
      // A full game ID was given: use its demo.
      const full = await appDetails(id);
      const demoId = full?.demos?.[0]?.appid;
      if (demoId) demo = await demoFromId(String(demoId));
    }
    if (demo && !demos.some((d) => d.appId === demo.appId)) demos.push(demo);
  }
  return demos;
}

module.exports = { fetchDemos };
