chrome.storage.local.get(["key", "sent", "queue"], ({ key, sent = [], queue = [] }) => {
  const state = document.getElementById("state");
  state.textContent = key
    ? `On. Every email you send from Gmail to someone outside George Yachts is tracked.${queue.length ? ` ${queue.length} waiting to reach GY Command.` : ""}`
    : "Not on yet. Open GY Command once in this Chrome (you are signed in there) and it switches on by itself.";
  const ul = document.getElementById("sent");
  for (const s of sent.slice(0, 5)) {
    const li = document.createElement("li");
    const when = new Date(s.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    li.innerHTML = `<b></b><br>`;
    li.querySelector("b").textContent = s.to;
    li.append(`${when} · ${s.subject || "(no subject)"}`);
    ul.appendChild(li);
  }
});
