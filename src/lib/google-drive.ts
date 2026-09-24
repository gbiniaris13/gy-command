// Google Drive mirror for booking documents (2026-09-24). George wants every
// contract, passport and preference sheet to also sit in his own Drive, in
// "George Yachts / Bookings / <charterer>", so the house keeps its own file
// independent of GY Command.
//
// Uses the same Google connection as Gmail (settings.gmail_refresh_token) and
// the `drive.file` scope, which only lets this app see and touch files it
// created itself. That scope was added to the consent list on 24/9; a token
// granted before that day does not carry it, and every function here says so
// plainly ("DRIVE_SCOPE_MISSING") instead of failing in the dark. George
// re-runs the Google connection once and the mirror starts working.

import { getAccessToken } from "@/lib/google-api";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_ROOT_FOLDER = "George Yachts";
export const DRIVE_BOOKINGS_FOLDER = "Bookings";

const FOLDER_MIME = "application/vnd.google-apps.folder";

let _scopeCache: { granted: boolean; at: number } | null = null;

/** Does the current Google token carry the Drive scope? Cached 10 minutes. */
export async function driveScopeGranted(): Promise<boolean> {
  if (_scopeCache && Date.now() - _scopeCache.at < 10 * 60 * 1000) return _scopeCache.granted;
  let granted = false;
  try {
    const token = await getAccessToken();
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
    if (res.ok) {
      const info = (await res.json()) as { scope?: string };
      granted = (info.scope || "").split(/\s+/).includes(DRIVE_SCOPE);
    }
  } catch {
    granted = false;
  }
  _scopeCache = { granted, at: Date.now() };
  return granted;
}

export function _invalidateDriveScopeCache(): void {
  _scopeCache = null;
}

async function driveFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(`https://www.googleapis.com/drive/v3/${path}`, { ...init, headers });
}

function escapeQ(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findFolder(name: string, parentId: string): Promise<string | null> {
  const q = `name = '${escapeQ(name)}' and '${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const res = await driveFetch(`files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=5`);
  if (!res.ok) throw new Error(`drive list ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

async function createFolder(name: string, parentId: string): Promise<string> {
  const res = await driveFetch("files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  if (!res.ok) throw new Error(`drive mkdir ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { id: string }).id;
}

/** Find or create the folder chain under My Drive; returns the last folder. */
export async function ensureFolderPath(names: string[]): Promise<{ id: string; link: string }> {
  let parent = "root";
  for (const name of names) {
    const found = await findFolder(name, parent);
    parent = found ?? (await createFolder(name, parent));
  }
  return { id: parent, link: `https://drive.google.com/drive/folders/${parent}` };
}

/** Multipart upload of one file into a folder; returns the Drive id + link. */
export async function uploadToDrive(
  folderId: string,
  name: string,
  mime: string,
  bytes: Buffer,
): Promise<{ id: string; link: string }> {
  const boundary = `gy${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name, parents: [folderId] });
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime || "application/octet-stream"}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--`);
  const body = Buffer.concat([head, bytes, tail]);
  const token = await getAccessToken();
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
      body: new Uint8Array(body),
    },
  );
  if (!res.ok) throw new Error(`drive upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { id: string; webViewLink?: string };
  return { id: data.id, link: data.webViewLink || `https://drive.google.com/file/d/${data.id}/view` };
}
