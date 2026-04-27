"use client";

import { useState } from "react";

export default function NewCampaignButton() {
  const [open, setOpen] = useState(false);
  const [stream, setStream] = useState<"general" | "advisor" | "bespoke">("general");
  const [brief, setBrief] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/admin/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stream,
          generate_with_ai: true,
          ai_brief: brief || undefined,
        }),
      });
      const j = (await res.json()) as { error?: string; campaign?: { id: string } };
      if (!res.ok || j.error || !j.campaign) {
        setError(j.error ?? "creation failed");
      } else {
        window.location.href = `/dashboard/newsletter/${j.campaign.id}`;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setCreating(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded"
      >
        + New campaign
      </button>
    );
  }
  return (
    <div className="border rounded p-3 bg-gray-50 space-y-2 w-96">
      <div className="flex gap-2">
        {(["general", "advisor", "bespoke"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStream(s)}
            className={`text-xs px-2 py-1 rounded border ${
              stream === s
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white border-gray-300 text-gray-700"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <textarea
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        rows={3}
        className="w-full text-sm border rounded p-2"
        placeholder="Optional brief — what's this month about? (Leave blank to let AI choose.)"
      />
      <div className="flex gap-2 items-center">
        <button
          onClick={create}
          disabled={creating}
          className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded disabled:opacity-50"
        >
          {creating ? "Generating…" : "Create draft"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="text-sm text-gray-600 underline"
        >
          Cancel
        </button>
        {error && <span className="text-sm text-red-600 ml-auto">{error}</span>}
      </div>
    </div>
  );
}
