"use client";

// 2026-05-20 — Calm operator theme. Was hardcoded #050A12 background
// + #00F0FF cyan title + cyan button (didn't pick up the calm token
// redefinition because all colours were inline literals). Rewritten
// to use the brand palette variables (--gy-ivory / --gy-navy /
// --gy-gold) so it sits visually with the rest of GY Command.

import { createBrowserSupabaseClient } from "@/lib/supabase";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function LoginContent() {
  const searchParams = useSearchParams();
  const gmailConnected = searchParams.get("gmail_connected");
  const [checking, setChecking] = useState(!!gmailConnected);

  useEffect(() => {
    if (gmailConnected === "true") {
      const supabase = createBrowserSupabaseClient();
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) {
          window.location.href = "/dashboard/email?connected=true";
        } else {
          setChecking(false);
        }
      });
    }
  }, [gmailConnected]);

  const handleGoogleSignIn = async () => {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  if (checking) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: "var(--gy-ivory)" }}
      >
        <div className="text-center">
          <div className="mb-4 text-2xl" style={{ color: "var(--gy-gold)" }}>✓</div>
          <p style={{ color: "var(--gy-navy)" }}>Gmail connected! Redirecting…</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: "var(--gy-ivory)" }}
    >
      <div className="w-full max-w-md">
        <div
          className="rounded-2xl border px-8 py-12"
          style={{
            borderColor: "var(--gy-border)",
            background: "var(--gy-paper)",
            boxShadow: "0 1px 2px rgba(13, 27, 42, 0.04), 0 8px 24px rgba(13, 27, 42, 0.06)",
          }}
        >
          <div className="mb-10 text-center">
            <h1
              className="text-2xl font-semibold tracking-[0.25em]"
              style={{ color: "var(--gy-navy)" }}
            >
              GEORGE YACHTS
            </h1>
            <p
              className="mt-2 text-sm font-medium tracking-widest"
              style={{ color: "var(--gy-navy-soft)" }}
            >
              Command Center
            </p>
          </div>
          <div
            className="mx-auto mb-8 h-px w-16"
            style={{ background: "var(--gy-gold)" }}
          />
          <button
            onClick={handleGoogleSignIn}
            className="group flex w-full items-center justify-center gap-3 rounded-lg px-6 py-3.5 text-sm font-semibold transition-all active:scale-[0.98]"
            style={{
              background: "var(--gy-navy)",
              color: "var(--gy-ivory)",
              border: "1px solid var(--gy-gold)",
              minHeight: "48px",
            }}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#F8F5F0" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#F8F5F0" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#F8F5F0" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#F8F5F0" />
            </svg>
            Sign in with Google
          </button>
          <p
            className="mt-8 text-center text-xs tracking-wider"
            style={{ color: "var(--gy-navy-mute)" }}
          >
            Authorized personnel only
          </p>
        </div>
        <p
          className="mt-6 text-center text-xs"
          style={{ color: "var(--gy-navy-mute)" }}
        >
          georgeyachts.com
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div
          className="flex min-h-screen items-center justify-center"
          style={{ background: "var(--gy-ivory)" }}
        >
          <p style={{ color: "var(--gy-navy-soft)" }}>Loading…</p>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
