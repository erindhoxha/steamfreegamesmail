# steam_free_games

Polls Steam every 30 minutes for free games. Once a day at 17:00 Europe/Berlin, if anything new was found, it creates a Mailjet campaign draft and emails a test copy for review. Nothing reaches subscribers until the draft is sent by hand in Mailjet.

Steam has no fixed giveaway day. Unlike Epic, which drops games every Thursday at 11:00 ET, Steam promotions are publisher-driven and land at random, often in windows as short as 24 hours. That is why polling is frequent but email is not.

## What counts as free

| Kind | Meaning | How it is detected |
| --- | --- | --- |
| `keep` | 100% discount. Claim it, own it forever. | Store search filtered to `maxprice=free&specials=1`, then each app verified through `appdetails` for `discount_percent === 100` and `final === 0`. |
| `weekend` | Temporary play-for-free window. You do not keep the game. | The `free_weekend` flag inside the storefront `GStoreItemData.AddStoreItemDataSet` payload. The store price never changes for these, so no price-based filter can find them. |

Permanently free-to-play games (`is_free: true`) are deliberately excluded. There are thousands of them and none are news.

## How the schedule works

Two workflows share state through `data/state.json`, committed back to the repo by the runner.

- `check-free-games.yml` runs `*/30 * * * *`. Anything new gets appended to `pending`. Games already in `pending` or `seen` are skipped, so a game found at 09:00 is not re-queued at 09:30.
- `draft-digest.yml` turns `pending` into one Mailjet campaign draft for the Steam list, sends a test copy to `TEST_RECIPIENT`, then moves those entries into `seen` and empties the queue. If `pending` is empty it does nothing. Review the test email, then open the draft link from the job log (or Mailjet → Campaigns → Drafts) and click Send.

GitHub cron is UTC only with no DST handling, so the digest workflow is scheduled at both 15:00 and 16:00 UTC. `draft-digest.js` exits immediately unless the current hour in Europe/Berlin is 17, so exactly one of the two slots runs on any given day.

Entries in `seen` expire after 45 days. Free weekends recur for the same game months apart, and without expiry a repeat promotion would never be announced again.

## Setup

1. Mailjet already has the contact list `SteamFreeGamesMail` (10597921), and `steamfreegamesmail.com` is a verified sending domain (SPF, DKIM and ownership records are in Namecheap DNS).
2. Add repository secrets: `MJ_APIKEY_PUBLIC`, `MJ_APIKEY_PRIVATE`.
3. Add repository variables: `MJ_CONTACT_LIST_ID`, `MJ_FROM_EMAIL`, `MJ_FROM_NAME`, `TEST_RECIPIENT`.
4. For local runs, copy `.env.example` to `.env` and fill it in.

## The email

`server/email.js` builds the HTML in code. It mirrors the Epic newsletter template, but campaign drafts can't use Mailjet's `var:items` loops, so there's no Mailjet template to maintain. Free-to-keep games and free weekends go in separate sections, and links carry `utm_source=efgm&utm_medium=email&utm_campaign=steam_free`.

## Local commands

```bash
npm run check       # poll Steam and update the queue
npm run preview     # write preview.html from the queue, no Mailjet calls, queue untouched
npm run draft       # create the draft only if it is 17:00 in Europe/Berlin
npm run draft:now   # ignore the time gate
```

## Website

`docs/` is the static site for steamfreegamesmail.com, served by GitHub Pages from the `/docs` folder of `master`. It mirrors epicfreegamesmail.com: Tailwind, the same layout, and a Mailjet subscription widget that adds confirmed contacts to `SteamFreeGamesMail`. The widget's look and wording are edited in Mailjet, not here.

```bash
npm run site:css    # rebuild docs/styles/output.css after changing classes
npm run site:dev    # serve docs/ at http://localhost:8765 with clean URLs, like GitHub Pages
```

## Maintenance note

The free weekend path parses an embedded JSON payload from the storefront HTML because Steam publishes no API for it. If free weekends stop appearing, `extractItemDataSets` in `server/steam.js` is the thing to check first. The free-to-keep path uses documented store endpoints and is more stable.
