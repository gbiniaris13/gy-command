"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import type { PipelineStage, Contact } from "@/lib/types";
import { getFlagFromCountry } from "@/lib/flags";
import { playSwoosh } from "@/lib/sounds";

interface Props {
  stages: PipelineStage[];
  contacts: Contact[];
}

const SOURCE_COLORS: Record<string, { bg: string; text: string }> = {
  website_lead: { bg: "bg-emerald-500/20", text: "text-emerald-400" },
  website_inquiry: { bg: "bg-emerald-500/20", text: "text-emerald-400" },
  outreach_bot: { bg: "bg-blue-500/20", text: "text-blue-400" },
  manual: { bg: "bg-neon-purple/20", text: "text-neon-purple" },
  referral: { bg: "bg-amber/20", text: "text-amber" },
  partner: { bg: "bg-pink-500/20", text: "text-pink-400" },
};

function sourceLabel(source: string | null): string {
  if (!source) return "Unknown";
  return source
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export default function DashboardClient({ stages, contacts: initial }: Props) {
  const [contacts, setContacts] = useState<Contact[]>(initial);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const dragCounter = useRef<Record<string, number>>({});

  // ─── Mouse drag-to-scroll ──────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDraggingScroll = useRef(false);
  const startX = useRef(0);
  const scrollLeft = useRef(0);

  function onMouseDownScroll(e: React.MouseEvent) {
    // Only engage scroll drag on the container background, not on cards
    if ((e.target as HTMLElement).closest("[data-kanban-card]")) return;
    const el = scrollRef.current;
    if (!el) return;
    isDraggingScroll.current = true;
    startX.current = e.pageX - el.offsetLeft;
    scrollLeft.current = el.scrollLeft;
    el.style.cursor = "grabbing";
  }

  function onMouseMoveScroll(e: React.MouseEvent) {
    if (!isDraggingScroll.current) return;
    e.preventDefault();
    const el = scrollRef.current;
    if (!el) return;
    const x = e.pageX - el.offsetLeft;
    const walk = (x - startX.current) * 1.5;
    el.scrollLeft = scrollLeft.current - walk;
  }

  function onMouseUpScroll() {
    isDraggingScroll.current = false;
    if (scrollRef.current) scrollRef.current.style.cursor = "grab";
  }

  const contactsByStage = useCallback(
    (stageId: string) =>
      contacts.filter((c) => c.pipeline_stage_id === stageId),
    [contacts]
  );

  // ─── Drag handlers ──────────────────────────────────────────────────────

  function onDragStart(e: React.DragEvent, contactId: string) {
    setDraggedId(contactId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", contactId);
    const el = e.currentTarget as HTMLElement;
    el.style.opacity = "0.5";
  }

  function onDragEnd(e: React.DragEvent) {
    (e.currentTarget as HTMLElement).style.opacity = "1";
    setDraggedId(null);
    setDragOverStage(null);
    dragCounter.current = {};
  }

  function onDragEnter(e: React.DragEvent, stageId: string) {
    e.preventDefault();
    dragCounter.current[stageId] = (dragCounter.current[stageId] || 0) + 1;
    setDragOverStage(stageId);
  }

  function onDragLeave(e: React.DragEvent, stageId: string) {
    e.preventDefault();
    dragCounter.current[stageId] = (dragCounter.current[stageId] || 0) - 1;
    if (dragCounter.current[stageId] <= 0) {
      dragCounter.current[stageId] = 0;
      if (dragOverStage === stageId) setDragOverStage(null);
    }
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  async function onDrop(e: React.DragEvent, stageId: string) {
    e.preventDefault();
    setDragOverStage(null);
    dragCounter.current = {};

    const contactId = e.dataTransfer.getData("text/plain");
    if (!contactId || !draggedId) return;

    const contact = contacts.find((c) => c.id === contactId);
    if (!contact || contact.pipeline_stage_id === stageId) return;

    playSwoosh();

    const newStage = stages.find((s) => s.id === stageId);
    setContacts((prev) =>
      prev.map((c) =>
        c.id === contactId
          ? {
              ...c,
              pipeline_stage_id: stageId,
              pipeline_stage: newStage ?? null,
              last_activity_at: new Date().toISOString(),
            }
          : c
      )
    );

    try {
      const res = await fetch(`/api/crm/contacts/${contactId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline_stage_id: stageId }),
      });
      if (!res.ok) {
        setContacts((prev) =>
          prev.map((c) =>
            c.id === contactId
              ? { ...c, pipeline_stage_id: contact.pipeline_stage_id, pipeline_stage: contact.pipeline_stage }
              : c
          )
        );
      }
    } catch {
      setContacts((prev) =>
        prev.map((c) =>
          c.id === contactId
            ? { ...c, pipeline_stage_id: contact.pipeline_stage_id, pipeline_stage: contact.pipeline_stage }
            : c
        )
      );
    }
  }

  // Check if a contact is HOT
  function isHot(contact: Contact): boolean {
    const stage = contact.pipeline_stage;
    if (!stage) return false;
    if (typeof stage === "object" && "name" in stage) {
      return (stage as PipelineStage).name === "Hot";
    }
    return false;
  }

  return (
    <div
      ref={scrollRef}
      className="flex gap-4 overflow-x-auto pb-4 kanban-scroll cursor-grab select-none touch-pan-x"
      onMouseDown={onMouseDownScroll}
      onMouseMove={onMouseMoveScroll}
      onMouseUp={onMouseUpScroll}
      onMouseLeave={onMouseUpScroll}
    >
      {stages.map((stage) => {
        const stageContacts = contactsByStage(stage.id);
        const isOver = dragOverStage === stage.id;
        return (
          <div
            key={stage.id}
            className={`flex w-[260px] sm:w-[280px] shrink-0 flex-col rounded-xl transition-all duration-200 ${
              isOver
                ? "bg-electric-cyan/5 ring-1 ring-electric-cyan/30"
                : "bg-deep-space/50"
            }`}
            onDragEnter={(e) => onDragEnter(e, stage.id)}
            onDragLeave={(e) => onDragLeave(e, stage.id)}
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, stage.id)}
          >
            {/* Column header */}
            <div className="flex items-center gap-2 px-3 py-3">
              <div
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: stage.color }}
              />
              <span className="font-[family-name:var(--font-display)] text-sm font-semibold text-soft-white/80">
                {stage.name}
              </span>
              <span className="ml-auto rounded-full bg-soft-white/5 px-2 py-0.5 font-[family-name:var(--font-mono)] text-xs text-muted-blue">
                {stageContacts.length}
              </span>
            </div>

            {/* Cards */}
            <div className="flex-1 space-y-2 px-2 pb-3 min-h-[80px]">
              {stageContacts.length === 0 && (
                <div className="flex h-[80px] items-center justify-center rounded-lg border border-dashed border-soft-white/5">
                  <p className="text-xs text-muted-blue/50">No contacts</p>
                </div>
              )}
              {stageContacts.map((contact) => {
                const srcColor = SOURCE_COLORS[contact.source ?? ""] ?? {
                  bg: "bg-gray-500/20",
                  text: "text-gray-400",
                };
                const hot = isHot(contact);
                return (
                  <Link
                    key={contact.id}
                    href={`/dashboard/contacts/${contact.id}`}
                    draggable
                    data-kanban-card
                    onDragStart={(e) => onDragStart(e, contact.id)}
                    onDragEnd={onDragEnd}
                    className={`block cursor-grab rounded-lg border bg-glass-dark p-3 shadow-sm transition-all active:cursor-grabbing ${
                      draggedId === contact.id
                        ? "border-electric-cyan/40 opacity-50"
                        : hot
                        ? "border-hot-red/30 animate-hot-pulse hover:border-hot-red/50"
                        : "border-border-glow hover:border-electric-cyan/20 hover:shadow-md"
                    }`}
                    style={{ borderLeftWidth: "3px", borderLeftColor: stage.color }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-soft-white">
                          {getFlagFromCountry(contact.country)}{" "}
                          {contact.first_name} {contact.last_name}
                        </p>
                        {contact.company && (
                          <p className="mt-0.5 truncate text-xs text-muted-blue">
                            {contact.company}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      {contact.source && (
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${srcColor.bg} ${srcColor.text}`}
                        >
                          {sourceLabel(contact.source)}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-blue/60">
                        {timeAgo(contact.last_activity_at)}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
