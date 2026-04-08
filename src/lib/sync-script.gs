/**
 * Google Apps Script — Sync "Prospects" sheet to GY Command CRM.
 *
 * SETUP:
 * 1. Open your Google Sheet with the "Prospects" tab.
 * 2. Go to Extensions > Apps Script.
 * 3. Paste this entire file.
 * 4. Set Script Properties (Project Settings > Script Properties):
 *    - SYNC_URL  = https://command.georgeyachts.com/api/sync
 *    - SYNC_SECRET = <your secret, must match SYNC_SECRET env var>
 * 5. Create a time-driven trigger:
 *    - Triggers > Add Trigger
 *    - Function: syncToCommand
 *    - Event source: Time-driven
 *    - Type: Minutes timer
 *    - Interval: Every 5 minutes
 */

function syncToCommand() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SYNC_URL");
  var secret = props.getProperty("SYNC_SECRET");

  if (!url || !secret) {
    Logger.log("ERROR: Missing SYNC_URL or SYNC_SECRET in Script Properties");
    return;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Prospects");

  if (!sheet) {
    Logger.log("ERROR: No sheet named 'Prospects' found");
    return;
  }

  var data = sheet.getDataRange().getValues();

  if (data.length < 2) {
    Logger.log("No data rows found");
    return;
  }

  // First row is headers — normalize to lowercase
  var headers = data[0].map(function (h) {
    return String(h).trim().toLowerCase().replace(/\s+/g, "_");
  });

  var emailIdx = headers.indexOf("email");
  if (emailIdx === -1) {
    Logger.log("ERROR: No 'email' column found in headers: " + headers.join(", "));
    return;
  }

  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      var val = data[i][j];
      row[headers[j]] = val !== null && val !== undefined ? String(val).trim() : "";
    }
    // Only include rows with an email
    if (row["email"]) {
      rows.push({
        email: row["email"],
        first_name: row["first_name"] || "",
        last_name: row["last_name"] || "",
        company: row["company"] || "",
        country: row["country"] || "",
        linkedin_url: row["linkedin_url"] || row["linkedin"] || "",
        status: row["status"] || "",
      });
    }
  }

  if (rows.length === 0) {
    Logger.log("No rows with email addresses found");
    return;
  }

  Logger.log("Syncing " + rows.length + " rows to GY Command...");

  var payload = {
    rows: rows,
    secret: secret,
  };

  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();
    var body = response.getContentText();

    if (code === 200) {
      var result = JSON.parse(body);
      Logger.log(
        "Sync OK: " +
          result.synced + " synced, " +
          result.updated + " updated, " +
          result.created + " created, " +
          result.activities + " activities, " +
          result.telegram_alerts + " alerts"
      );
    } else {
      Logger.log("Sync FAILED (" + code + "): " + body);
    }
  } catch (err) {
    Logger.log("Sync ERROR: " + err.toString());
  }
}
