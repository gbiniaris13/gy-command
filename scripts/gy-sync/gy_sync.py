#!/usr/bin/env python3
# GY Sync: WhatsApp + iMessage/SMS on George's Mac -> The Helm (16/11/2026).
#
# Runs inside "GY Sync.app" (the only thing given Full Disk Access), every 10
# minutes via launchd. Reads COPIES of the local databases, read-only, and
# sends to the Helm ONLY messages with phone numbers that belong to Helm
# requests (the server tells it which). Nothing else leaves the Mac.
#
# Mode file ~/Library/Application Support/GYSync/MODE:
#   inspect -> writes report.json (counts and table names, no message text), sends nothing
#   sync    -> sends the matched messages
import json, os, re, shutil, sqlite3, sys, tempfile, time, glob, urllib.request, datetime

HOME = os.path.expanduser("~")
BASE = os.path.join(HOME, "Library/Application Support/GYSync")
API = "https://command.georgeyachts.com/api/helm/conversation-sync"
APPLE_EPOCH = 978307200  # 2001-01-01
LOG = os.path.join(BASE, "last-run.log")

def log(*a):
    with open(LOG, "a") as f:
        f.write(datetime.datetime.now().isoformat(timespec="seconds") + " " + " ".join(str(x) for x in a) + "\n")

def d9(s):
    return re.sub(r"\D", "", s or "")[-9:]

def copy_db(path, tmp):
    """Copy a live SQLite db (+wal/shm) so we never touch or lock the original."""
    dst = os.path.join(tmp, os.path.basename(path))
    shutil.copy2(path, dst)
    for ext in ("-wal", "-shm"):
        if os.path.exists(path + ext):
            shutil.copy2(path + ext, dst + ext)
    con = sqlite3.connect("file:" + dst + "?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con

def cols(con, table):
    return [r[1] for r in con.execute(f"PRAGMA table_info('{table}')")]

def tables(con):
    return [r[0] for r in con.execute("select name from sqlite_master where type='table'")]

def http(method, body=None):
    token = open(os.path.join(BASE, "token")).read().strip()
    req = urllib.request.Request(API, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())

def apple_ts(v):
    if v is None:
        return None
    v = float(v)
    if v > 1e15:  # nanoseconds (Messages)
        v = v / 1e9
    return datetime.datetime.utcfromtimestamp(v + APPLE_EPOCH).replace(tzinfo=datetime.timezone.utc)

def mac_contacts_name_to_phones(tmp, report):
    """Contact full name -> set of 9-digit phones, from the Mac address book."""
    out = {}
    for path in glob.glob(os.path.join(HOME, "Library/Application Support/AddressBook/Sources/*/AddressBook-v22.abcddb")):
        try:
            con = copy_db(path, tmp)
            for r in con.execute("select r.ZFIRSTNAME f, r.ZLASTNAME l, p.ZFULLNUMBER n from ZABCDRECORD r join ZABCDPHONENUMBER p on p.ZOWNER = r.Z_PK"):
                name = " ".join(x for x in [r["f"], r["l"]] if x).strip().lower()
                if name and r["n"]:
                    out.setdefault(name, set()).add(d9(r["n"]))
        except Exception as e:
            report.setdefault("errors", []).append(f"addressbook: {e}")
    report["mac_contacts_names"] = len(out)
    return out

def whatsapp(tmp, targets, report, name_phones):
    found = []
    by9 = {}
    for t in targets:
        by9.setdefault(t["phone9"], []).append(t)
    for app in ("group.net.whatsapp.WhatsApp.shared", "group.net.whatsapp.WhatsAppSMB.shared"):
        root = os.path.join(HOME, "Library/Group Containers", app)
        chat = os.path.join(root, "ChatStorage.sqlite")
        rep = report.setdefault("whatsapp", {}).setdefault(app, {})
        if not os.path.exists(chat):
            rep["present"] = False
            continue
        rep["present"] = True
        try:
            con = copy_db(chat, tmp)
        except Exception as e:
            rep["error"] = str(e)
            continue
        rep["tables"] = [t for t in tables(con) if t.startswith("ZWA")][:40]
        # lid/jid -> phone from ContactsV2 (newer WhatsApp keeps @lid ids)
        jid_phone = {}
        cv2 = os.path.join(root, "ContactsV2.sqlite")
        if os.path.exists(cv2):
            try:
                cc = copy_db(cv2, tmp)
                for t in tables(cc):
                    cs = cols(cc, t)
                    phone_c = [c for c in cs if "PHONE" in c.upper()]
                    id_c = [c for c in cs if any(k in c.upper() for k in ("LID", "JID", "WHATSAPPID"))]
                    if phone_c and id_c:
                        for row in cc.execute(f"select {', '.join(phone_c + id_c)} from {t}"):
                            ph = next((d9(str(row[c])) for c in phone_c if row[c]), "")
                            for c in id_c:
                                if row[c] and ph:
                                    jid_phone[str(row[c]).split("@")[0]] = ph
                rep["contactsv2_ids"] = len(jid_phone)
            except Exception as e:
                rep["contactsv2_error"] = str(e)
        sessions = {}
        for s in con.execute("select Z_PK, ZCONTACTJID, ZPARTNERNAME from ZWACHATSESSION"):
            jid = s["ZCONTACTJID"] or ""
            if jid.endswith("@g.us") or "status" in jid:
                continue
            user = jid.split("@")[0]
            cand = set()
            if jid.endswith("@s.whatsapp.net"):
                cand.add(d9(user))
            if user in jid_phone:
                cand.add(jid_phone[user])
            pn = (s["ZPARTNERNAME"] or "").strip()
            if len(re.sub(r"\D", "", pn)) >= 9:
                cand.add(d9(pn))
            for ph in name_phones.get(pn.lower(), ()):
                cand.add(ph)
            hits = [t for c in cand for t in by9.get(c, [])]
            if hits:
                sessions[s["Z_PK"]] = hits
        rep["matched_chats"] = len(sessions)
        n = 0
        for pk, hits in sessions.items():
            for m in con.execute("select Z_PK, ZISFROMME, ZTEXT, ZMESSAGEDATE, ZSTANZAID from ZWAMESSAGE where ZCHATSESSION = ? and ZTEXT is not null order by ZMESSAGEDATE desc limit 400", (pk,)):
                ts = apple_ts(m["ZMESSAGEDATE"])
                if not ts:
                    continue
                for t in hits:
                    if ts.isoformat() < t["since"][:19]:
                        continue
                    found.append({"request_id": t["id"], "ts": ts.isoformat(), "from_me": bool(m["ZISFROMME"]),
                                  "text": m["ZTEXT"], "channel": "whatsapp", "key": f"{app[-10:]}:{m['ZSTANZAID'] or m['Z_PK']}:{t['id'][:8]}"})
                    n += 1
        rep["messages"] = n
    return found

def body_from_attributed(b):
    if not b:
        return None
    try:
        i = b.find(b"NSString")
        if i < 0:
            return None
        j = i + len(b"NSString") + 5
        ln = b[j]
        j += 1
        if ln == 0x81:
            ln = int.from_bytes(b[j:j + 2], "little"); j += 2
        return b[j:j + ln].decode("utf-8", "ignore")
    except Exception:
        return None

def imessage(tmp, targets, report):
    found = []
    path = os.path.join(HOME, "Library/Messages/chat.db")
    rep = report.setdefault("imessage", {})
    if not os.path.exists(path):
        rep["present"] = False
        return found
    by9 = {}
    for t in targets:
        by9.setdefault(t["phone9"], []).append(t)
    try:
        con = copy_db(path, tmp)
    except Exception as e:
        rep["error"] = str(e)
        return found
    handles = {}
    for h in con.execute("select ROWID, id from handle"):
        hits = by9.get(d9(h["id"]), [])
        if hits and "@" not in (h["id"] or ""):
            handles[h["ROWID"]] = hits
    rep["matched_handles"] = len(handles)
    n = 0
    for hid, hits in handles.items():
        for m in con.execute("select guid, text, attributedBody, is_from_me, date from message where handle_id = ? order by date desc limit 400", (hid,)):
            text = m["text"] or body_from_attributed(m["attributedBody"])
            ts = apple_ts(m["date"])
            if not text or not ts:
                continue
            for t in hits:
                if ts.isoformat() < t["since"][:19]:
                    continue
                found.append({"request_id": t["id"], "ts": ts.isoformat(), "from_me": bool(m["is_from_me"]),
                              "text": text, "channel": "imessage", "key": f"{m['guid']}:{t['id'][:8]}"})
                n += 1
    rep["messages"] = n
    return found

# ── Send on WhatsApp (16/11/2026) ───────────────────────────────────────────
# George clicks "Send on WhatsApp" in the Helm → one item in the outbox. Here:
# save the number in Contacts if it is new, open the chat in the WhatsApp app
# with the text in place, press Return, then CHECK WhatsApp's own database that
# the message really left. Never retried: a failed item is reported, not resent.
import subprocess, urllib.parse

OUTBOX = "https://command.georgeyachts.com/api/helm/wa-outbox"
WA_DB = os.path.join(HOME, "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite")

def http_outbox(method, body=None):
    token = open(os.path.join(BASE, "token")).read().strip()
    req = urllib.request.Request(OUTBOX, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

def osa(script):
    p = subprocess.run(["/usr/bin/osascript", "-e", script], capture_output=True, text=True, timeout=30)
    return p.returncode, (p.stdout + p.stderr).strip()

def esc(t):
    return (t or "").replace("\\", "\\\\").replace('"', '\\"')

def known_phone(phone9):
    tmp = tempfile.mkdtemp(prefix="gysync-c-")
    try:
        names = mac_contacts_name_to_phones(tmp, {})
        return any(phone9 in v for v in names.values())
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def save_contact(it):
    if known_phone(d9(it["phone"])):
        return "already in contacts"
    subprocess.run(["/usr/bin/open", "-gj", "-a", "Contacts"], timeout=20)
    time.sleep(2)
    code, out = osa(f'''tell application "Contacts"
  set p to make new person with properties {{first name:"{esc(it['first_name'])}", last name:"{esc(it['last_name'])}", organization:"{esc(it['org'])}", note:"{esc(it['note'])}"}}
  make new phone at end of phones of p with properties {{label:"mobile", value:"+{it['phone']}"}}
  save
end tell''')
    return "saved to contacts" if code == 0 else f"contacts not saved ({out[:80]})"

def find_sent(text, since_apple):
    tmp = tempfile.mkdtemp(prefix="gysync-v-")
    try:
        con = copy_db(WA_DB, tmp)
        head = (text or "").strip()[:60]
        for m in con.execute("select ZSTANZAID, Z_PK, ZMESSAGEDATE, ZTEXT from ZWAMESSAGE where ZISFROMME = 1 and ZMESSAGEDATE > ? order by ZMESSAGEDATE desc limit 30", (since_apple,)):
            if (m["ZTEXT"] or "").strip()[:60] == head:
                return m
        return None
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def send_one(it):
    started = time.time() - APPLE_EPOCH - 5
    contact = save_contact(it)
    url = "whatsapp://send?phone=" + it["phone"] + "&text=" + urllib.parse.quote(it["text"])
    subprocess.run(["/usr/bin/open", url], timeout=20)
    time.sleep(5)
    subprocess.run(["/usr/bin/open", "-a", "WhatsApp"], timeout=20)
    time.sleep(1.5)
    code, out = osa('''tell application "System Events"
  set f to name of first application process whose frontmost is true
  if f is not "WhatsApp" then error "WhatsApp is not in front (" & f & ")"
  keystroke return
end tell''')
    if code != 0:
        return {"status": "failed", "detail": f"Δεν πάτησα αποστολή: {out[:140]}. Το κείμενο έμεινε γραμμένο στο WhatsApp. {contact}"}
    for _ in range(5):
        time.sleep(3)
        m = find_sent(it["text"], started)
        if m:
            ts = apple_ts(m["ZMESSAGEDATE"]).isoformat()
            key = f"App.shared:{m['ZSTANZAID'] or m['Z_PK']}:{it['request_id'][:8]}"
            return {"status": "sent", "detail": f"στάλθηκε, {contact}", "key": key, "ts": ts}
    return {"status": "failed", "detail": f"Πάτησα αποστολή αλλά δεν το βλέπω στο WhatsApp. Έλεγξε τη συνομιλία πριν το ξαναστείλεις. {contact}"}

def run_outbox():
    try:
        items = http_outbox("GET").get("items", [])
    except Exception as e:
        log("outbox get failed", repr(e)); return
    for it in items:
        try:
            res = send_one(it)
        except Exception as e:
            res = {"status": "failed", "detail": "σφάλμα: " + repr(e)[:150]}
        res["id"] = it["id"]
        try:
            http_outbox("POST", res)
        except Exception as e:
            log("outbox post failed", repr(e))
        log("outbox", it["id"][:8], res["status"], res.get("detail", ""))

def main():
    os.makedirs(BASE, exist_ok=True)
    run_outbox()
    # The full read runs every ~10 minutes; this agent wakes every 20 seconds
    # for the outbox.
    stamp = os.path.join(BASE, "last-full")
    try:
        if time.time() - os.path.getmtime(stamp) < 540:
            return
    except Exception:
        pass
    open(stamp, "w").write(str(time.time()))
    mode = "inspect"
    try:
        mode = open(os.path.join(BASE, "MODE")).read().strip() or "inspect"
    except Exception:
        pass
    report = {"at": datetime.datetime.now().isoformat(timespec="seconds"), "mode": mode}
    tmp = tempfile.mkdtemp(prefix="gysync-")
    try:
        targets = http("GET")["targets"]
        report["targets"] = len(targets)
        names = mac_contacts_name_to_phones(tmp, report)
        msgs = whatsapp(tmp, targets, report, names) + imessage(tmp, targets, report)
        report["total_messages"] = len(msgs)
        report["requests_with_messages"] = len({m["request_id"] for m in msgs})
        per = {}
        for m in msgs:
            e = per.setdefault(m["request_id"], {"n": 0, "last": "", "channels": []})
            e["n"] += 1
            e["last"] = max(e["last"], m["ts"])
            if m["channel"] not in e["channels"]:
                e["channels"].append(m["channel"])
        report["per_request"] = per  # counts and dates only, never text
        if mode == "sync" and msgs:
            sources = {"whatsapp": report.get("whatsapp"), "imessage": report.get("imessage")}
            for i in range(0, len(msgs), 500):
                r = http("POST", {"messages": msgs[i:i + 500], "sources": sources if i == 0 else None})
                report.setdefault("posted", []).append(r)
        elif mode == "sync":
            http("POST", {"messages": [], "sources": {"note": "nothing new"}})
    except Exception as e:
        report["error"] = repr(e)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)  # the copies hold private messages: never keep them
        with open(os.path.join(BASE, "report.json"), "w") as f:
            json.dump(report, f, indent=1, default=str)
        log(mode, "targets", report.get("targets"), "messages", report.get("total_messages"), "error", report.get("error"))

if __name__ == "__main__":
    main()
