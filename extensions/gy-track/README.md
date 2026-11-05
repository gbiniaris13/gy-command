# GY Track

Tracks the emails George writes himself in Gmail (Chrome on the Mac), the
same way The Helm tracks its own: every open, every click, re-opens, one
alert thread per email in his inbox. No third parties.

Install once: chrome://extensions → Developer mode → Load unpacked → this
folder. It opens GY Command once to fetch its key; nothing to paste.

What it does at Send (only when a recipient is outside georgeyachts.com):
tracked links, the open pixel, quoted old pixels removed. If anything
fails, the email still sends, untracked. It also tells GY Command when
George himself is looking at a tracked email, so his own reading never
counts, and it blocks his Chrome from loading the pixel.

Server side: /api/t/ext/{key,register,seen}, lib/sent-copy.ts,
cron tracking-clean-sent.
