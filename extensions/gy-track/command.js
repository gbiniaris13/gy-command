// GY Track, Command side: fetch the signing key from a tab where George is
// signed in to GY Command. Once a day at most; nothing to type or paste.
(async () => {
  try {
    const { keyAt = 0 } = await chrome.storage.local.get(["keyAt"]);
    if (Date.now() - keyAt < 24 * 3600_000) return;
    const r = await fetch("/api/t/ext/key", { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    if (j && j.key) chrome.runtime.sendMessage({ type: "key", key: j.key });
  } catch { /* try again on the next Command page */ }
})();
