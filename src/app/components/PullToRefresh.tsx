"use client";

import { useState, useRef, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export default function PullToRefresh({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [pullY, setPullY] = useState(0);
  const startY = useRef(0);
  const pulling = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const el = containerRef.current;
    if (!el || el.scrollTop > 0) return;
    startY.current = e.touches[0].clientY;
    pulling.current = true;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!pulling.current) return;
    const dy = Math.max(0, e.touches[0].clientY - startY.current);
    setPullY(Math.min(dy * 0.4, 80));
  }, []);

  const onTouchEnd = useCallback(async () => {
    if (!pulling.current) return;
    pulling.current = false;
    if (pullY > 50) {
      setRefreshing(true);
      router.refresh();
      await new Promise((r) => setTimeout(r, 800));
      setRefreshing(false);
    }
    setPullY(0);
  }, [pullY, router]);

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className="h-full overflow-y-auto"
    >
      {/* Pull indicator */}
      <div
        className="flex items-center justify-center overflow-hidden transition-all duration-200 lg:hidden"
        style={{ height: refreshing ? 40 : pullY > 10 ? pullY : 0 }}
      >
        <div
          className={`h-5 w-5 rounded-full border-2 border-electric-cyan border-t-transparent ${
            refreshing ? "animate-spin" : ""
          }`}
          style={{
            opacity: refreshing ? 1 : Math.min(pullY / 60, 1),
            transform: `rotate(${pullY * 4}deg)`,
          }}
        />
      </div>
      {children}
    </div>
  );
}
