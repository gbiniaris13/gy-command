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
// 3. THE RING. A thin gold ring around Send means "this email will be
//    tracked". No ring: it will not (internal recipients only, no recipient
//    yet, or the extension is not on). The popup says why.

(() => {
  const BASE = "https://command.georgeyachts.com";
  const PIXEL_RE = /\/api\/t\/o\?t=([A-Za-z0-9_-]{6,40})/;
  const OURS = /@georgeyachts\.com$/i;
  const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  const SELFTEST = "GYTRACK-SELFTEST";
  let KEY = null;

  const store = (obj) => { try { chrome.storage.local.set(obj); } catch { /* context gone */ } };
  chrome.storage.local.get(["key"], (r) => { KEY = r.key || null; });
  chrome.storage.onChanged.addListener((ch) => { if (ch.key) KEY = ch.key.newValue || null; });
  store({ gmailAlive: Date.now() });

  const inQuote = (el) => !!(el.closest && el.closest(".gmail_quote, blockquote"));

  // Only the company mailbox. In another Gmail account open in this Chrome
  // (George's personal one) nothing is tracked and nothing is reported as
  // "seen": an email he sends himself there as a test must count as opened.
  let ACCOUNT = null;
  function account() {
    if (ACCOUNT) return ACCOUNT;
    const el = document.querySelector('a[aria-label^="Google Account:"], [aria-label^="Google Account:"]');
    const m = ((el && el.getAttribute("aria-label")) || "").match(EMAIL) || document.title.match(EMAIL);
    if (m) ACCOUNT = m[0].toLowerCase();
    return ACCOUNT;
  }
  const otherAccount = () => { const a = account(); return !!a && !OURS.test(a); };

  // ── Finding things in Gmail, each with fallbacks ──
  const BODY_SEL = '[g_editable="true"], div[contenteditable="true"][role="textbox"], div.editable[contenteditable="true"], div[contenteditable="true"][aria-label="Message Body"]';
  function isSendButton(el) {
    const btn = el && el.closest && el.closest('[role="button"]');
    if (!btn) return null;
    if (btn.classList.contains("aoO")) return btn;
    const label = (btn.getAttribute("data-tooltip") || btn.getAttribute("aria-label") || "").trim();
    return /^(Send|Αποστολή)(\s|$|‪|\()/i.test(label) && !/feedback|σχόλ/i.test(label) ? btn : null;
  }
  function sendButtons() {
    const out = new Set(document.querySelectorAll(".aoO"));
    document.querySelectorAll('[role="button"][data-tooltip^="Send"], [role="button"][aria-label^="Send"], [role="button"][data-tooltip^="Αποστολή"], [role="button"][aria-label^="Αποστολή"]').forEach((b) => { if (isSendButton(b)) out.add(b); });
    return [...out];
  }
  // One compose window (or one inline reply), never two. In Gmail the body
  // and Send live in one block and the recipients and subject in a sibling
  // form, so the root is the nearest ancestor that holds the body, a Send
  // button AND the subject field; while climbing it must still hold a
  // single Send button. Without a subject field in reach, the body+Send
  // block is the root.
  const SUBJECT_SEL = 'input[name="subjectbox"]';
  function composeRoot(from) {
    const sends = sendButtons();
    let el = from, inner = null;
    for (let i = 0; el && el !== document.body && i < 80; i++, el = el.parentElement) {
      if (!el.querySelector) continue;
      if (!inner) {
        if (el.querySelector(BODY_SEL) && sends.some((b) => el.contains(b))) inner = el;
        else continue;
      }
      if (sends.filter((b) => el.contains(b)).length > 1) break;
      if (el.querySelector(SUBJECT_SEL)) return el;
    }
    return inner;
  }
  const bodyOf = (root) => root.querySelector(BODY_SEL);

  function recipients(root, body) {
    const set = new Set();
    const add = (v) => (String(v || "").match(EMAIL) || []).forEach((e) => { if (!OURS.test(e)) set.add(e.toLowerCase()); });
    let all = 0;
    const count = (v) => { const n = (String(v || "").match(EMAIL) || []).length; all += n; add(v); };
    root.querySelectorAll("input, textarea").forEach((i) => {
      const tag = `${i.getAttribute("name") || ""} ${i.getAttribute("aria-label") || ""} ${i.hasAttribute("peoplekit-id") ? "peoplekit" : ""}`;
      if (/^(to|cc|bcc)\s|recipient|παραλ|peoplekit/i.test(tag)) count(i.value);
    });
    root.querySelectorAll("[email], [data-hovercard-id], [data-email]").forEach((el) => {
      if (body.contains(el)) return;
      count(el.getAttribute("email"));
      count(el.getAttribute("data-hovercard-id"));
      count(el.getAttribute("data-email"));
    });
    // An inline reply can keep its recipients folded away. Then the people
    // of the open conversation are the recipients.
    let via = "draft";
    if (!all && !root.querySelector(SUBJECT_SEL)) {
      via = "conversation";
      document.querySelectorAll("[email]").forEach((el) => { if (!el.closest(BODY_SEL)) count(el.getAttribute("email")); });
    }
    return { external: [...set], any: all > 0, via };
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
    let made = 0;
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
        made++;
      }
      frag.appendChild(document.createTextNode(text.slice(last)));
      n.parentNode.replaceChild(frag, n);
    }
    return made;
  }

  // What would happen to this draft, without touching it.
  function verdict(root) {
    if (otherAccount()) return { track: false, why: `This Gmail is ${account()}, not the company mailbox.` };
    if (!KEY) return { track: false, why: "GY Track has no key yet. Open GY Command once in this Chrome." };
    const body = root && bodyOf(root);
    if (!root || !body) return { track: false, why: "Could not find the draft in this Gmail window." };
    const r = recipients(root, body);
    if (!r.external.length) return { track: false, why: r.any ? "Only George Yachts recipients: internal mail is not tracked." : "No recipient yet." };
    return { track: true, why: "", to: r.external, body, via: r.via };
  }

  let lastSend = { root: null, at: 0 };

  function onSend(fromEl, opts) {
    const selftest = !!(opts && opts.selftest);
    const report = (ok, why, extra) => store({ lastAttempt: { at: Date.now(), ok, why, selftest, ...(extra || {}) } });
    try {
      const root = composeRoot(fromEl);
      if (root && lastSend.root === root && Date.now() - lastSend.at < 4000) return null;
      const v = verdict(root);
      if (!v.track) { report(false, v.why); return v; }
      const body = v.body;

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

      let links = 0;
      body.querySelectorAll("a[href]").forEach((a) => {
        if (inQuote(a)) return;
        const href = a.getAttribute("href") || "";
        if (!/^https?:\/\//i.test(href)) return;
        if (href.startsWith(`${BASE}/api/t/`)) { links++; return; }
        a.setAttribute("href", tracked(token, href));
        links++;
      });
      links += wrapBareUrls(body, token);

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
      const to = v.to.join(", ");
      const subject = subjectOf(root);
      chrome.runtime.sendMessage({ type: "register", token, to, subject });
      report(true, "", { to, subject, links, token });
      return { track: true, to: v.to, links, subject, token, pixel: !!body.querySelector(`img[src*="/api/t/o?t=${token}"]`) };
    } catch (e) {
      report(false, `Error: ${e && e.message ? e.message : e}`);
      console.warn("[GY Track] send left untracked:", e);
      return { track: false, why: String(e) };
    }
  }

  // Capture phase on window: we run before Gmail's own handlers.
  const press = (e) => { const b = isSendButton(e.target); if (b) onSend(b); };
  window.addEventListener("pointerdown", press, true);
  window.addEventListener("mousedown", press, true);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSend(e.target);
    else if ((e.key === "Enter" || e.key === " ") && isSendButton(e.target)) onSend(e.target);
  }, true);

  // ── THE RING, and a line of plain text for diagnosis ──
  let diag = null;
  const tested = new WeakSet();
  function tick() {
    try {
      const lines = [];
      for (const btn of sendButtons()) {
        const root = composeRoot(btn);
        const v = verdict(root);
        btn.style.boxShadow = v.track ? "0 0 0 2px #fff, 0 0 0 4px #b08d57" : "";
        const base = (btn.getAttribute("data-tooltip") || "").replace(/\s*·\s*GY Track.*$/, "");
        if (base) btn.setAttribute("data-tooltip", `${base} · GY Track: ${v.track ? "tracked" : "not tracked"}`);
        let line = v.track ? `will track, ${v.to.length} recipient(s) read from the ${v.via}, subject field ${root.querySelector(SUBJECT_SEL) ? "found" : "not found"}` : `not tracked: ${v.why}`;
        // Self-test: a draft with this exact subject is instrumented at once
        // (never sent), so the whole Send path can be checked on real Gmail.
        if (root && subjectOf(root) === SELFTEST && !tested.has(root)) {
          tested.add(root);
          const r = onSend(btn, { selftest: true });
          line += ` | selftest: ${JSON.stringify(r && { track: r.track, to: r.to, links: r.links, pixel: r.pixel, why: r.why })}`;
          root.dataset.gySelftest = line;
        } else if (root && root.dataset.gySelftest) {
          line = root.dataset.gySelftest;
        }
        lines.push(line);
      }
      if (!diag) {
        diag = document.createElement("div");
        diag.setAttribute("role", "status");
        diag.setAttribute("style", "position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden");
        document.body.appendChild(diag);
      }
      const text = `GY Track diag: account ${account() || "unknown"}; key ${KEY ? "yes" : "no"}; drafts ${lines.length}${lines.length ? "; " + lines.join(" || ") : ""}`;
      if (diag.textContent !== text) { diag.textContent = text; diag.setAttribute("aria-label", text); }
    } catch { /* never in Gmail's way */ }
  }
  setInterval(tick, 1200);

  // ── SEEN ──
  const reported = new Map();
  let scanTimer = null;
  function scan() {
    scanTimer = null;
    try {
      if (!KEY || otherAccount()) return;
      const tokens = [];
      document.querySelectorAll('img[src*="/api/t/o?t="]').forEach((img) => {
        if (img.closest(BODY_SEL)) return;
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
