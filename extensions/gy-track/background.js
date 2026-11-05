// GY Track, background: talks to GY Command and keeps George's own Chrome
// out of the counts.
const BASE = "https://command.georgeyachts.com";

async function getKey() {
  return (await chrome.storage.local.get(["key"])).key || null;
}

// Rule 1: George's Chrome never loads our pixel itself (the draft he is
// sending, a preview in Command). Rule 2: his clicks on tracked links carry
// x-gy-self, so the server files them as his.
async function setRules(key) {
  const addRules = [
    { id: 1, priority: 1, action: { type: "block" }, condition: { urlFilter: "||command.georgeyachts.com/api/t/o", resourceTypes: ["image"] } },
  ];
  if (key) {
    addRules.push({
      id: 2,
      priority: 1,
      action: { type: "modifyHeaders", requestHeaders: [{ header: "x-gy-self", operation: "set", value: key }] },
      condition: { urlFilter: "||command.georgeyachts.com/api/t/c", resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest", "other"] },
    });
  }
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [1, 2], addRules });
  await chrome.action.setBadgeText({ text: key ? "" : "!" });
  await chrome.action.setBadgeBackgroundColor({ color: "#b08d57" });
}

// Registrations queue in storage until GY Command has them, so a send made
// offline or during a hiccup is still recorded later.
let chain = Promise.resolve();
function serial(fn) {
  chain = chain.then(fn, fn);
  return chain;
}

async function flush() {
  const key = await getKey();
  if (!key) return;
  const { queue = [] } = await chrome.storage.local.get(["queue"]);
  const left = [];
  for (const item of queue) {
    try {
      const r = await fetch(`${BASE}/api/t/ext/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-gy-ext": key },
        body: JSON.stringify(item),
      });
      if (r.ok) {
        const { sent = [] } = await chrome.storage.local.get(["sent"]);
        sent.unshift({ to: item.to, subject: item.subject, at: item.at });
        await chrome.storage.local.set({ sent: sent.slice(0, 10) });
      } else if (r.status >= 500) {
        left.push(item);
      }
    } catch {
      left.push(item);
    }
  }
  await chrome.storage.local.set({ queue: left.filter((i) => Date.now() - i.at < 3 * 86400_000) });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "register") {
    serial(async () => {
      const { queue = [] } = await chrome.storage.local.get(["queue"]);
      queue.push({ token: msg.token, to: msg.to, subject: msg.subject, at: Date.now() });
      await chrome.storage.local.set({ queue });
      // Gmail's Undo send holds the email a few seconds; register after it.
      await new Promise((r) => setTimeout(r, 1500));
      await flush();
    });
  } else if (msg.type === "seen") {
    (async () => {
      const key = await getKey();
      if (!key) return;
      fetch(`${BASE}/api/t/ext/seen`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-gy-ext": key },
        body: JSON.stringify({ tokens: msg.tokens }),
      }).catch(() => {});
    })();
  } else if (msg.type === "key" && typeof msg.key === "string") {
    serial(async () => {
      await chrome.storage.local.set({ key: msg.key, keyAt: Date.now() });
      await setRules(msg.key);
      await flush();
    });
  }
});

chrome.alarms.create("flush", { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "flush") serial(flush); });

chrome.runtime.onStartup.addListener(() => serial(async () => { await setRules(await getKey()); await flush(); }));
chrome.runtime.onInstalled.addListener(() => serial(async () => {
  const key = await getKey();
  await setRules(key);
  // First install: open GY Command once; the key is fetched from there.
  if (!key) chrome.tabs.create({ url: `${BASE}/dashboard` });
}));
