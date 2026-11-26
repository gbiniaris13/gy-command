// src/lib/aftersales/card.ts
import { gmailFetch } from "@/lib/google-api";
import { greetingCard } from "@/lib/lighthouse-card";
import type { Kind } from "@/lib/aftersales/plan";

// Birthdays and the holiday letter leave as the Lighthouse's Edition card
// (George's card, 29/8/2026); everything else as a plain personal email.
export const CARD_KINDS: Kind[] = ["birthday", "holiday", "season"];

/** "...\n\nWarmly,\nGeorge" -> the body without the sign-off, and "Warmly,". */
export function splitSignOff(body: string): { body: string; closing: string } {
  const paras = body.trim().split(/\n{2,}/);
  const lines = (paras[paras.length - 1] ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
  if (lines[lines.length - 1] === "George") {
    paras.pop();
    return { body: paras.join("\n\n"), closing: lines.length > 1 ? lines[0] : "Warmly," };
  }
  return { body: body.trim(), closing: "Warmly," };
}

export async function sendCard(args: { to: string; subject: string; body: string; kind: Kind; us: boolean }): Promise<{ messageId: string }> {
  const { body, closing } = splitSignOff(args.body);
  const cardKind = args.kind === "birthday" ? "birthday" : args.kind === "season" ? "western_christmas" : args.us ? "thanksgiving" : "western_christmas";
  const html = greetingCard({ kind: cardKind, subject: args.subject.replace(/^\[ΔΟΚΙΜΗ[^\]]*\]\s*/, ""), body, closing });
  const boundary = `gy_card_${Date.now()}`;
  const raw = Buffer.from(
    [
      `From: George P. Biniaris <george@georgeyachts.com>`,
      `To: ${args.to}`,
      `Subject: =?UTF-8?B?${Buffer.from(args.subject, "utf8").toString("base64")}?=`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(args.body, "utf8").toString("base64"),
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(html, "utf8").toString("base64"),
      `--${boundary}--`,
    ].join("\r\n"),
  ).toString("base64url");
  const res = await gmailFetch("/messages/send", { method: "POST", body: JSON.stringify({ raw }) });
  if (!res.ok) throw new Error(`gmail ${res.status}`);
  const data = await res.json();
  return { messageId: data.id };
}

