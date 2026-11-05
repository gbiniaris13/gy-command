// GY Track, Gmail side.
//
// 1. SEND. At the moment George presses Send (mouse or Cmd/Ctrl+Enter), on a
//    draft with at least one recipient outside georgeyachts.com: links are
//    routed through our click counter, the open pixel goes in, pixels quoted
//    from earlier emails come out, and the background registers the email.
//    All of it is synchronous and wrapped in try/catch: whatever happens,
//    Gmail sends. The worst case is an email that leaves untracked.
// 2. SEEN. When Gmail shows George an email that carries one of our pixels
//    (his own copy, or a client's reply quoting him), we say so, so that
//    the open it causes is filed as his and never reaches him as an alert.

(() => {
  const BASE = "https://command.georgeyachts.com";
  const PIXEL_RE = /\/api\/t\/o\?t=([A-Za-z0-9_-]{6,40})/;
  const OURS = /@georgeyachts\.com$/i;
  const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  let KEY = null;

  chrome.storage.local.get(["key"], (r) => { KEY = r.key || null; });
  chrome.storage.onChanged.addListener((ch) => { if (ch.key) KEY = ch.key.newValue || null; });

  const inQuote = (el) => !!(el.closest && el.closest(".gmail_quote, blockquote"));

  // The nearest ancestor holding both the draft body and its Send button:
  // that is one compose window (or one inline reply), never two.
  const SEND_SEL = '.aoO, [role="button"][data-tooltip^="Send"], [role="button"][aria-label^="Send"], [role="button"][data-tooltip^="Αποστολή"]';
  function composeRoot(from) {
    let el = from;
    for (let i = 0; el && i < 40; i++, el = el.parentElement) {
      if (el.querySelector && el.querySelector('[g_editable="true"]') && el.querySelector(SEND_SEL)) return el;
    }
    return null;
  }

  function recipients(root, body) {
    const set = new Set();
    const add = (v) => (String(v || "").match(EMAIL) || []).forEach((e) => { if (!OURS.test(e)) set.add(e.toLowerCase()); });
    root.querySelectorAll('input[name="to"], input[name="cc"], input[name="bcc"]').forEach((i) => add(i.value));
    root.querySelectorAll("[email], [data-hovercard-id]").forEach((el) => {
      if (body.contains(el)) return;
      add(el.getAttribute("email"));
      add(el.getAttribute("data-hovercard-id"));
    });
    return [...set];
  }

  function subjectOf(root) {
    const input = root.querySelector('input[name="subjectbox"]');
    const v = (input && input.value) || (document.querySelector("h2.hP") || {}).innerText || "";
    return v.trim().slice(0, 300);
  }

  function tracked(token, url) {
    return `${BASE}/api/t/c?t=${token}&u=${GYCrypto.b64urlText(url)}&s=${GYCrypto.sign(KEY, `${token}|${url}`)}`;
  }

  function wrapBareUrls(body, token) {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (!/https?:\/\//i.test(n.nodeValue)) continue;
      const p = n.parentElement;
      if (!p || p.closest("a") || inQuote(p)) continue;
      nodes.push(n);
    }
    for (const n of nodes) {
      const text = n.nodeValue;
      const re = /https?:\/\/[^\s<>"']+/gi;
      const frag = document.createDocumentFragment();
      let last = 0, m;
      while ((m = re.exec(text))) {
        let url = m[0];
        const trail = url.match(/[.,;:!?)\]]+$/);
        if (trail) url = url.slice(0, -trail[0].length);
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const a = document.createElement("a");
        a.setAttribute("href", tracked(token, url));
        a.textContent = url;
        frag.appendChild(a);
        last = m.index + url.length;
      }
      frag.appendChild(document.createTextNode(text.slice(last)));
      n.parentNode.replaceChild(frag, n);
    }
  }

  let lastSend = { root: null, at: 0 };

  function onSend(fromEl) {
    try {
      if (!KEY) return;
      const root = composeRoot(fromEl);
      if (!root) return;
      if (lastSend.root === root && Date.now() - lastSend.at < 4000) return;
      const body = root.querySelector('[g_editable="true"]');
      if (!body) return;
      const to = recipients(root, body);
      if (!to.length) return;

      // One token per email. After Undo send the draft comes back with our
      // pixel in it: keep that token, so the email stays one record.
      let token = null;
      body.querySelectorAll("img").forEach((img) => {
        const m = (img.getAttribute("src") || "").match(PIXEL_RE);
        if (!m) return;
        if (inQuote(img)) { img.remove(); return; }
        if (!token) token = m[1];
        else if (m[1] !== token) img.remove();
      });
      if (!token) token = GYCrypto.token();

      body.querySelectorAll("a[href]").forEach((a) => {
        if (inQuote(a)) return;
        const href = a.getAttribute("href") || "";
        if (!/^https?:\/\//i.test(href) || href.startsWith(`${BASE}/api/t/`)) return;
        a.setAttribute("href", tracked(token, href));
      });
      wrapBareUrls(body, token);

      if (!body.querySelector(`img[src*="/api/t/o?t=${token}"]`)) {
        const img = document.createElement("img");
        img.setAttribute("src", `${BASE}/api/t/o?t=${token}`);
        img.setAttribute("width", "1");
        img.setAttribute("height", "1");
        img.setAttribute("alt", "");
        img.setAttribute("style", "width:1px;height:1px;border:0");
        const quote = body.querySelector(".gmail_quote");
        let anchor = quote;
        while (anchor && anchor.parentElement !== body) anchor = anchor.parentElement;
        if (anchor) body.insertBefore(img, anchor);
        else body.appendChild(img);
      }
      body.dispatchEvent(new Event("input", { bubbles: true }));

      lastSend = { root, at: Date.now() };
      chrome.runtime.sendMessage({ type: "register", token, to: to.join(", "), subject: subjectOf(root) });
    } catch (e) {
      console.warn("[GY Track] send left untracked:", e);
    }
  }

  function isSendButton(el) {
    const btn = el && el.closest && el.closest('[role="button"]');
    if (!btn) return null;
    if (btn.classList.contains("aoO")) return btn;
    const label = btn.getAttribute("data-tooltip") || btn.getAttribute("aria-label") || "";
    return /^(Send|Αποστολή)(\s|$|‪|\()/i.test(label.trim()) ? btn : null;
  }

  // Capture phase on window: we run before Gmail's own handlers.
  window.addEventListener("mousedown", (e) => { const b = isSendButton(e.target); if (b) onSend(b); }, true);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSend(e.target);
    else if ((e.key === "Enter" || e.key === " ") && isSendButton(e.target)) onSend(e.target);
  }, true);

  // ── SEEN ──
  const reported = new Map();
  let scanTimer = null;
  function scan() {
    scanTimer = null;
    try {
      if (!KEY) return;
      const tokens = [];
      document.querySelectorAll('img[src*="/api/t/o?t="]').forEach((img) => {
        if (img.closest('[g_editable="true"]')) return;
        const m = (img.getAttribute("src") || "").match(PIXEL_RE);
        if (!m) return;
        const t = m[1];
        if (Date.now() - (reported.get(t) || 0) < 90_000) return;
        reported.set(t, Date.now());
        tokens.push(t);
      });
      if (tokens.length) chrome.runtime.sendMessage({ type: "seen", tokens });
    } catch { /* never in Gmail's way */ }
  }
  new MutationObserver(() => {
    if (!scanTimer) scanTimer = setTimeout(scan, 300);
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
})();
