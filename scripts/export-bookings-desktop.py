import json, os, re, urllib.request, datetime
# Snapshot of the won bookings to ~/Desktop/GY BOOKINGS (George 24/9): one folder per charter with
# every filed paper + BOOKING SUMMARY.txt, and GY-BOOKINGS.xlsx as the index. Reads the service key
# from ../.env.local (or a gyc.env beside it). Run: python3 scripts/export-bookings-desktop.py
import openpyxl
from openpyxl.styles import Font, Alignment
SP = os.path.dirname(os.path.abspath(__file__))
ENV = {}
ENV_FILE = next(f for f in [os.path.join(SP, "..", "gyc.env"), os.path.join(SP, "..", ".env.local")] if os.path.exists(f))
for line in open(ENV_FILE):
    if "=" in line and not line.startswith("#"):
        k, v = line.strip().split("=", 1); ENV[k] = v.strip().strip('"')
SB, KEY, CRON = ENV["NEXT_PUBLIC_SUPABASE_URL"], ENV["SUPABASE_SERVICE_ROLE_KEY"], ENV["CRON_SECRET"]
API = "https://command.georgeyachts.com/api/helm"
ROOT = os.path.expanduser("~/Desktop/GY BOOKINGS")
LABEL = {"contract":"Contract","passport":"Passport","preference_sheet":"Preferences","crew_list":"Crew list","invoice":"Invoice","payment_proof":"Payment proof","other":"KYC & other"}
def get(url, hdr):
    return urllib.request.urlopen(urllib.request.Request(url, headers=hdr), timeout=180).read()
rows = json.loads(get(f"{SB}/rest/v1/helm_requests?status=eq.won&client_name=not.ilike.*TEST*&select=id,client_title,client_name,client_surname,client_email,client_whatsapp,dates_from,dates_to,party_size,area,created_at,extraction", {"apikey": KEY, "Authorization": f"Bearer {KEY}"}))
rows.sort(key=lambda r: r["dates_from"])
os.makedirs(ROOT, exist_ok=True)
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Bookings"
head = ["Charterer","Yacht","From","To","Nights","Guests","Owner company / stakeholder","Payment status","Payment notes","Contract","Passport","Payment proof","Documents","Drive folder","Helm link","Email","Phone"]
ws.append(head)
for c in ws[1]: c.font = Font(bold=True)
def fmt(d): return datetime.date.fromisoformat(d).strftime("%d %b %Y") if d else ""
for r in rows:
    b = (r["extraction"] or {}).get("booking") or {}
    surname = r["client_surname"] or r["client_name"]
    name = f"{surname} - {b.get('vessel','')} - {r['dates_from']} to {r['dates_to']}".replace("/", "-")
    folder = os.path.join(ROOT, name); os.makedirs(folder, exist_ok=True)
    docs = b.get("documents") or []
    for d in docs:
        out = os.path.join(folder, f"{LABEL.get(d['type'], d['type'])} - {d['name']}")
        if os.path.exists(out) and os.path.getsize(out) == d["size"]: continue
        data = get(f"{API}/{r['id']}/booking-docs/{d['id']}", {"Authorization": f"Bearer {CRON}"})
        open(out, "wb").write(data)
    nights = (datetime.date.fromisoformat(r["dates_to"]) - datetime.date.fromisoformat(r["dates_from"])).days
    nm = re.sub(r"^(Mr|Mrs|Ms|Dr|Miss)\.?\s+", "", (r["client_name"] or "").strip())
    if "family" in nm.lower():
        who = nm[0].upper() + nm[1:]
    elif r["client_surname"] and r["client_surname"].lower() in nm.lower():
        who = " ".join(x for x in [r["client_title"], nm] if x)
    else:
        who = " ".join(x for x in [r["client_title"], nm, r["client_surname"]] if x)
    summary = [f"BOOKING - {surname.upper()} - {b.get('vessel','')}", "",
        f"Charterer:        {who}", f"Email:            {r['client_email'] or ''}", f"Phone:            {r['client_whatsapp'] or ''}",
        f"Yacht:            {b.get('vessel','')}", f"Charter period:   {fmt(r['dates_from'])} to {fmt(r['dates_to'])} ({nights} nights)",
        f"Guests:           {r['party_size'] or ''}", f"Cruising area:    {r['area'] or ''}",
        f"Owner / stakeholder: {b.get('owner_company','')}", f"White label:      {'yes' if b.get('white_label') else 'no'}",
        f"Payment status:   {b.get('payment_status','')}", "", "Payment notes:", f"  {b.get('payment_notes','')}", "",
        "Documents:"] + [f"  [{LABEL.get(d['type'], d['type'])}] {d['name']}  ({d['size']//1024} KB, filed {d['uploaded_at'][:10]})" for d in docs] + ["",
        f"Drive folder:     {b.get('drive_folder_link','')}", f"The Helm:         https://command.georgeyachts.com/dashboard/helm/{r['id']}",
        f"The Cabin:        {'linked (' + b['cabin_id'] + ')' if b.get('cabin_id') else 'not opened yet'}", "",
        f"Exported from The Helm on {datetime.date.today().strftime('%d %b %Y')}. The Helm and Drive are the live copies; this folder is a snapshot."]
    open(os.path.join(folder, "BOOKING SUMMARY.txt"), "w").write("\n".join(summary))
    have = lambda t: "yes" if any(d["type"] == t for d in docs) else "NO"
    ws.append([who, b.get("vessel",""), fmt(r["dates_from"]), fmt(r["dates_to"]), nights, r["party_size"], b.get("owner_company",""), b.get("payment_status",""), b.get("payment_notes",""), have("contract"), have("passport"), have("payment_proof"), len(docs), b.get("drive_folder_link",""), f"https://command.georgeyachts.com/dashboard/helm/{r['id']}", r["client_email"], r["client_whatsapp"]])
    print(name, "->", len(docs), "files")
for col, w in zip("ABCDEFGHIJKLMNOPQ", [28,20,13,13,7,7,44,15,60,9,9,13,10,40,40,30,18]): ws.column_dimensions[col].width = w
for row in ws.iter_rows(min_row=2):
    for c in row: c.alignment = Alignment(wrap_text=True, vertical="top")
wb.save(os.path.join(ROOT, "GY-BOOKINGS.xlsx"))
open(os.path.join(ROOT, "README.txt"), "w").write("GY BOOKINGS\n\nOne folder per confirmed charter: the fully signed MYBA contract, the charterer's passport, payment proofs, KYC papers, preferences and crew list, plus BOOKING SUMMARY.txt with every detail.\nGY-BOOKINGS.xlsx is the index of all charters.\n\nLive copies: The Helm (command.georgeyachts.com, Won, column Booking) and Google Drive / George Yachts / Bookings.\nThis folder is a snapshot exported from The Helm; ask for a refresh when new papers are filed.\n")
print("xlsx + README written to", ROOT)
