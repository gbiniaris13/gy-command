# Per-Bot Stats Sync — Paste-Ready Snippet

This is the .gs side of the per-bot Outreach dashboard (commits
`0accc6e` + `ffb5404` + `6851f3a` on gy-command). Once you paste this
into both `outreach-automation-v3.gs` and
`outreach-automation-elleanna.gs`, the Outreach dashboard's two
"per-bot snapshot" cards light up with live numbers, and the daily
07:05 UTC system-health-check cron starts grading each bot's last
sync age.

## 1. One-time env var on Vercel (gy-command project)

Set on **command.georgeyachts.com** project, all environments:

```
SYNC_SECRET = <pick a random ≥32-char string>
```

Generate with: `openssl rand -hex 32`

## 2. Mirror the same value into both .gs CONFIG blocks

Inside the `CONFIG = { ... }` block of each file, add:

```js
  // gy-command per-bot stats endpoint
  STATS_API: 'https://command.georgeyachts.com/api/outreach-stats',
  STATS_SECRET: '<paste the SYNC_SECRET value here>',
```

`BOT_ID` is already set (`'george'` in v3, `'elleanna'` in the other
file) so we reuse it.

## 3. Add this function near the bottom of each .gs

Drop it just above the `// ===== UTILITIES =====` block (or anywhere
top-level — order doesn't matter):

```js
function syncStatsToCommand_() {
  if (!CONFIG.STATS_API || !CONFIG.STATS_SECRET) return;

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  // Row 0 is header. Adjust column indexes if the sheet schema drifts.
  const HEADER = data[0].map(function(h) { return String(h || '').trim(); });
  function col(name) { return HEADER.indexOf(name); }

  const cStatus = col('Status');     // empty | sent | followup_1 | replied | bounced | unsubscribed | won
  const cReply  = col('Replied At'); // any non-empty timestamp = reply
  const cBounce = col('Bounced At');

  let totalSent = 0, replies = 0, bounces = 0, active = 0, remaining = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = String(row[cStatus] || '').toLowerCase();
    if (!status || status === 'queued') { remaining += 1; continue; }
    if (status === 'bounced') { bounces += 1; totalSent += 1; continue; }
    if (status === 'replied' || (cReply >= 0 && row[cReply])) { replies += 1; totalSent += 1; continue; }
    if (status.indexOf('followup') === 0 || status === 'sent') {
      totalSent += 1;
      if (status !== 'won' && status !== 'lost') active += 1;
    }
  }

  const body = {
    secret: CONFIG.STATS_SECRET,
    bot: CONFIG.BOT_ID,            // "george" or "elleanna"
    source: 'bot',
    total_sent: totalSent,
    opens: 0,                      // open-tracking lives elsewhere; leave 0 for now
    replies: replies,
    bounces: bounces,
    leads_remaining: remaining,
    active_followups: active
  };

  try {
    UrlFetchApp.fetch(CONFIG.STATS_API, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
  } catch (e) {
    Logger.log('syncStatsToCommand_ failed: ' + e);
  }
}
```

## 4. Wire the daily trigger

In Apps Script editor: **Triggers → Add Trigger**

- Function: `syncStatsToCommand_`
- Event source: `Time-driven`
- Type: `Day timer`
- Time: `2am to 3am` (so it runs before the 07:05 UTC health check)

Save. Repeat for the elleanna .gs.

## 5. Verify

Hit `https://command.georgeyachts.com/api/outreach-stats` from a
browser. The response JSON now has a populated `perBot` field:

```json
{
  "perBot": {
    "george":   { "total_sent": ..., "replies": ..., "updated_at": "..." },
    "elleanna": { "total_sent": ..., "replies": ..., "updated_at": "..." }
  }
}
```

Refresh the Outreach dashboard — the "Per-bot snapshot" strip
appears above the existing 6-tile aggregate, with two live cards.

## What if you skip this?

Nothing breaks. The per-bot UI strip stays hidden, the legacy single
`outreach_stats` snapshot continues to work as before, and the new
health-check `Outreach bots` line just reports "no per-bot snapshots
yet" (ok severity, not a warning).
