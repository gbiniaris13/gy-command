// Sends ONE test card to george@georgeyachts.com only. Never to a client.
import { sendCard } from "../../src/lib/aftersales/card";
(async () => {
  const to = "george@georgeyachts.com";
  const body = "Hey Caroline,\n\nA very happy birthday to you from Athens. May the day be full of the people you love, and the year ahead as calm as a quiet anchorage.\n\nWarmly,\nGeorge";
  const r = await sendCard({ to, subject: "[ΔΟΚΙΜΗ Lighthouse για Caroline] Happy birthday", body, kind: "birthday", us: true });
  console.log("sent to", to, r.messageId);
})().catch((e) => { console.error(e); process.exit(1); });
