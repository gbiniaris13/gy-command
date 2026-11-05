chrome.storage.local.get(["key", "sent", "queue", "gmailAlive", "lastAttempt"], ({ key, sent = [], queue = [], gmailAlive, lastAttempt }) => {
  const state = document.getElementById("state");
  const when = (t) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const lines = [
    key
      ? "On. A gold ring around Send means that email will be tracked."
      : "Not on yet. Open GY Command once in this Chrome (you are signed in there) and it switches on by itself.",
    gmailAlive ? `Gmail: connected (${when(gmailAlive)}).` : "Gmail: not connected. Reload your Gmail tab once.",
  ];
  if (lastAttempt) {
    lines.push(lastAttempt.ok
      ? `Last send (${when(lastAttempt.at)}): tracked, ${lastAttempt.links || 0} link(s).`
      : `Last send (${when(lastAttempt.at)}): NOT tracked. ${lastAttempt.why || ""}`);
  }
  if (queue.length) lines.push(`${queue.length} waiting to reach GY Command.`);
  state.textContent = "";
  for (const l of lines) { const p = document.createElement("div"); p.textContent = l; p.style.marginBottom = "6px"; state.appendChild(p); }
  const ul = document.getElementById("sent");
  for (const s of sent.slice(0, 5)) {
    const li = document.createElement("li");
    const b = document.createElement("b");
    b.textContent = s.to;
    li.append(b, document.createElement("br"), `${when(s.at)} · ${s.subject || "(no subject)"}`);
    ul.appendChild(li);
  }
});
