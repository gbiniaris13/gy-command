"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, type ReactNode } from "react";
import NotificationBell from "./NotificationBell";
import { isSoundEnabled, toggleSound, playBlip, playChord } from "@/lib/sounds";
import AlienBackground from "@/app/components/AlienBackground";
import AutoRefresh from "@/app/components/AutoRefresh";
import PullToRefresh from "@/app/components/PullToRefresh";

interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
}

const navItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
  {
    label: "Contacts",
    href: "/dashboard/contacts",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
  },
  {
    label: "Email",
    href: "/dashboard/email",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
      </svg>
    ),
  },
  {
    label: "Calendar",
    href: "/dashboard/calendar",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
      </svg>
    ),
  },
  {
    label: "Chat",
    href: "/dashboard/chat",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
      </svg>
    ),
  },
  {
    label: "Outreach",
    href: "/dashboard/outreach",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
      </svg>
    ),
  },
  {
    label: "Visitors",
    href: "/dashboard/visitors",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
      </svg>
    ),
  },
  {
    label: "Revenue",
    href: "/dashboard/revenue",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    label: "Fleet",
    href: "/dashboard/fleet",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
      </svg>
    ),
  },
  {
    label: "Command",
    href: "/dashboard/command-center",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5" />
        <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75v2.25m0 12v2.25M3.75 12H6m12 0h2.25" />
      </svg>
    ),
  },
];

// Bottom bar items for mobile: Dashboard, Contacts, Email, Fleet, Chat
const bottomBarItems: NavItem[] = [
  navItems[0], // Dashboard
  navItems[1], // Contacts
  navItems[2], // Email
  navItems[8], // Fleet
  navItems[4], // Chat
];

function WelcomeGate({ children }: { children: React.ReactNode }) {
  const [showWelcome, setShowWelcome] = useState(false);
  const [welcomeDone, setWelcomeDone] = useState(false);

  useEffect(() => {
    const todayKey = `gy-welcome-${new Date().toISOString().slice(0, 10)}`;
    if (!localStorage.getItem(todayKey)) {
      setShowWelcome(true);
    } else {
      setWelcomeDone(true);
    }
  }, []);

  function handleDismiss() {
    const todayKey = `gy-welcome-${new Date().toISOString().slice(0, 10)}`;
    localStorage.setItem(todayKey, "1");
    setShowWelcome(false);
    setWelcomeDone(true);
  }

  if (showWelcome && !welcomeDone) {
    return <WelcomeScreen onDismiss={handleDismiss} />;
  }

  return <>{children}</>;
}

function WelcomeScreen({ onDismiss }: { onDismiss: () => void }) {
  const [step, setStep] = useState(0);
  const [counts, setCounts] = useState([0, 0, 0, 0]);
  const [targets, setTargets] = useState([0, 0, 0, 0]);
  const labels = ["Hot Leads", "Emails Sent", "Meetings Today", "New Replies"];

  // Fetch real stats from API
  useEffect(() => {
    fetch("/api/welcome-stats")
      .then((r) => r.json())
      .then((d) => {
        setTargets([
          d.hotLeads ?? 0,
          d.emailsSent ?? 0,
          d.meetingsToday ?? 0,
          d.newReplies ?? 0,
        ]);
      })
      .catch(() => {
        // Keep zeros on error
      });
  }, []);
  const icons = [
    <svg key="hot" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" /></svg>,
    <svg key="email" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>,
    <svg key="cal" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" /></svg>,
    <svg key="reply" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" /></svg>,
  ];

  // Step animation timeline
  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 300); // greeting
    const t2 = setTimeout(() => setStep(2), 800); // date
    const t3 = setTimeout(() => setStep(3), 1200); // cards stagger start
    const t4 = setTimeout(() => setStep(4), 3500); // button appears
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, []);

  // Count-up animation — re-runs when targets load or step advances
  useEffect(() => {
    if (step < 3) return;
    let raf: number;
    const startTime = performance.now();
    const duration = 1500;
    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCounts(targets.map((t) => Math.round(t * eased)));
      if (progress < 1) {
        raf = requestAnimationFrame(animate);
      }
    }
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [step, targets]);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-deep-space">
      {/* Mesh gradient bg */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_40%,rgba(0,240,255,0.04)_0%,transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_30%_70%,rgba(139,92,246,0.04)_0%,transparent_60%)]" />
      </div>

      <div className="relative z-10 flex flex-col items-center px-6 text-center">
        {/* Greeting */}
        <h1
          className="font-[family-name:var(--font-display)] text-2xl font-bold text-soft-white sm:text-3xl md:text-4xl transition-all duration-700"
          style={{
            opacity: step >= 1 ? 1 : 0,
            transform: step >= 1 ? "translateY(0)" : "translateY(16px)",
          }}
        >
          {greeting}, George.
        </h1>

        {/* Date */}
        <p
          className="mt-2 text-sm text-muted-blue transition-all duration-700"
          style={{
            opacity: step >= 2 ? 1 : 0,
            transform: step >= 2 ? "translateY(0)" : "translateY(12px)",
          }}
        >
          {dateStr}
        </p>

        {/* Stat cards */}
        <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {targets.map((_, i) => (
            <div
              key={i}
              className="glass-card flex flex-col items-center p-5 sm:p-6 min-w-[130px] transition-all duration-500"
              style={{
                opacity: step >= 3 ? 1 : 0,
                transform: step >= 3 ? "translateY(0)" : "translateY(20px)",
                transitionDelay: `${i * 150}ms`,
              }}
            >
              <div className="mb-2 text-electric-cyan/50">
                {icons[i]}
              </div>
              <span className="font-[family-name:var(--font-mono)] text-3xl font-bold text-electric-cyan sm:text-4xl">
                {counts[i]}
              </span>
              <span className="mt-1 text-[11px] font-medium tracking-wider text-muted-blue uppercase">
                {labels[i]}
              </span>
            </div>
          ))}
        </div>

        {/* Enter button */}
        <button
          onClick={onDismiss}
          className="mt-10 rounded-xl border border-electric-cyan/20 bg-electric-cyan/5 px-8 py-3 font-[family-name:var(--font-display)] text-sm font-semibold text-electric-cyan cyan-glow transition-all duration-500 hover:bg-electric-cyan/10 hover:border-electric-cyan/40 min-h-[44px]"
          style={{
            opacity: step >= 4 ? 1 : 0,
            transform: step >= 4 ? "translateY(0)" : "translateY(12px)",
          }}
        >
          Enter Command Center &rarr;
        </button>
      </div>
    </div>
  );
}

function QuickActionsFAB() {
  const [open, setOpen] = useState(false);

  const actions = [
    { label: "New Lead", href: "/dashboard/contacts?new=1", icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
      </svg>
    )},
    { label: "Quick Email", href: "/dashboard/email", icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
      </svg>
    )},
    { label: "Schedule", href: "/dashboard/calendar", icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
      </svg>
    )},
    { label: "Command", href: "/dashboard/command-center", icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    )},
  ];

  return (
    <div className="fixed bottom-20 right-4 z-50 lg:hidden">
      {/* Expanded actions */}
      {open && (
        <div className="mb-3 flex flex-col gap-2 animate-fade-in-up">
          {actions.map((a) => (
            <Link
              key={a.label}
              href={a.href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg border border-electric-cyan/20 bg-deep-space/95 backdrop-blur-lg px-4 py-2.5 text-xs font-medium text-electric-cyan shadow-lg shadow-electric-cyan/10 transition-all hover:border-electric-cyan/40 min-h-[44px]"
            >
              {a.icon}
              {a.label}
            </Link>
          ))}
        </div>
      )}
      {/* FAB button */}
      <button
        onClick={() => setOpen(!open)}
        className="flex h-14 w-14 items-center justify-center rounded-full border border-electric-cyan/30 bg-deep-space/90 backdrop-blur-lg shadow-lg shadow-electric-cyan/20 transition-all hover:border-electric-cyan/50 min-h-[44px] min-w-[44px]"
        aria-label="Quick actions"
      >
        <svg
          className={`h-6 w-6 text-electric-cyan transition-transform duration-200 ${open ? "rotate-45" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      </button>
    </div>
  );
}

function MobileMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-blue transition-colors hover:bg-glass-light hover:text-soft-white min-h-[44px] min-w-[44px] lg:hidden"
        aria-label="Open menu"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      </button>
      {open && (
        <div className="fixed inset-0 z-[100] lg:hidden">
          <div className="absolute inset-0 bg-deep-space/95 backdrop-blur-lg" onClick={() => setOpen(false)} />
          <div className="relative z-10 flex flex-col h-full p-6">
            <div className="flex items-center justify-between mb-8">
              <span className="font-[family-name:var(--font-display)] text-lg font-bold text-electric-cyan tracking-wider">GY COMMAND</span>
              <button
                onClick={() => setOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-blue hover:text-soft-white min-h-[44px] min-w-[44px]"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <nav className="space-y-1">
              {navItems.map((item) => {
                const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors min-h-[44px] ${
                      active
                        ? "bg-electric-cyan/5 text-electric-cyan border border-electric-cyan/20"
                        : "text-muted-blue hover:text-soft-white hover:bg-glass-light/50"
                    }`}
                  >
                    {item.icon}
                    <span className="font-[family-name:var(--font-sans)]">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
            <div className="mt-auto pt-6 border-t border-border-glow">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-electric-cyan/10 border border-electric-cyan/20 text-electric-cyan">
                  <span className="font-[family-name:var(--font-display)] text-xs font-semibold">GP</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-soft-white">George P. Biniaris</p>
                  <p className="text-[10px] font-semibold tracking-wider text-electric-cyan uppercase">Commander</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SoundToggle() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    setEnabled(isSoundEnabled());
  }, []);

  return (
    <button
      onClick={() => {
        const next = toggleSound();
        setEnabled(next);
      }}
      className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-blue transition-colors hover:bg-glass-light hover:text-soft-white min-h-[44px] min-w-[44px]"
      aria-label={enabled ? "Mute sounds" : "Unmute sounds"}
      title={enabled ? "Sounds on" : "Sounds off"}
    >
      {enabled ? (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
        </svg>
      ) : (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
        </svg>
      )}
    </button>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  const isOnChatPage = pathname.startsWith("/dashboard/chat");

  return (
    <WelcomeGate>
      <AlienBackground />
      <AutoRefresh intervalMs={60000} />
      <div className="flex h-screen overflow-hidden" style={{ position: "relative", zIndex: 10, background: "transparent" }}>
        {/* ─── Desktop Sidebar ─────────────────────────────────────────── */}
        <aside
          className={`hidden lg:flex shrink-0 flex-col border-r border-border-glow transition-all duration-300 ${
            collapsed ? "w-16" : "w-60"
          }`}
          style={{ background: "rgba(1,8,16,0.85)", backdropFilter: "blur(8px)" }}
        >
          {/* Logo row + collapse toggle */}
          <div className="flex h-14 items-center justify-between px-3">
            <div className={`flex items-center gap-2.5 ${collapsed ? "justify-center w-full" : ""}`}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-electric-cyan/10 border border-electric-cyan/20">
                <span className="font-[family-name:var(--font-display)] text-xs font-bold text-electric-cyan">
                  GY
                </span>
              </div>
              {!collapsed && (
                <span className="font-[family-name:var(--font-display)] text-sm font-semibold tracking-wide text-soft-white">
                  GY Command
                </span>
              )}
            </div>
            <button
              onClick={() => setCollapsed(!collapsed)}
              className={`rounded-md p-1.5 text-muted-blue transition-colors hover:bg-glass-light hover:text-soft-white min-h-[44px] min-w-[44px] flex items-center justify-center ${
                collapsed ? "hidden" : ""
              }`}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                {collapsed ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                )}
              </svg>
            </button>
          </div>

          {/* Divider */}
          <div className="mx-3 h-px bg-border-glow" />

          {/* Nav */}
          <nav className="flex-1 space-y-0.5 px-2 py-4">
            {navItems.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  onMouseEnter={playBlip}
                  onClick={playChord}
                  className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors min-h-[44px] ${
                    active
                      ? "bg-[rgba(0,240,255,0.05)] text-electric-cyan"
                      : "text-muted-blue hover:bg-glass-light/50 hover:text-soft-white"
                  } ${collapsed ? "justify-center px-0" : ""}`}
                >
                  {/* Active indicator */}
                  {active && (
                    <div className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-electric-cyan" />
                  )}
                  {item.icon}
                  {!collapsed && (
                    <span className="font-[family-name:var(--font-sans)]">
                      {item.label}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Divider */}
          <div className="mx-3 h-px bg-border-glow" />

          {/* User area */}
          <div className={`flex items-center gap-3 px-3 py-4 ${collapsed ? "justify-center" : ""}`}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-electric-cyan/10 border border-electric-cyan/20 text-electric-cyan">
              <span className="font-[family-name:var(--font-display)] text-xs font-semibold">
                GP
              </span>
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-soft-white">
                  George P. Biniaris
                </p>
                <p className="truncate text-[10px] font-semibold tracking-wider text-electric-cyan uppercase">
                  Commander
                </p>
              </div>
            )}
          </div>
        </aside>

        {/* ─── Main content ───────────────────────────────────────────── */}
        <main className="relative flex-1 overflow-y-auto pb-16 lg:pb-0">
          {/* Top bar — compact on mobile with logo + hamburger */}
          <div className="sticky top-0 z-40 flex items-center border-b border-border-glow bg-deep-space/95 backdrop-blur-lg px-3 sm:px-6 h-12">
            {/* Mobile: logo + GY CMD */}
            <div className="flex items-center gap-2 lg:hidden">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-electric-cyan/10 border border-electric-cyan/20">
                <span className="font-[family-name:var(--font-mono)] text-[10px] font-bold text-electric-cyan">GY</span>
              </div>
              <span className="font-[family-name:var(--font-mono)] text-xs font-semibold text-electric-cyan tracking-wider">CMD</span>
            </div>
            {/* Spacer */}
            <div className="flex-1" />
            <SoundToggle />
            <NotificationBell />
            {/* Mobile hamburger */}
            <MobileMenu />
          </div>
          <PullToRefresh>
            <div className="animate-page-enter">{children}</div>
          </PullToRefresh>

          {/* Quick Actions FAB (mobile only) */}
          <QuickActionsFAB />

          {/* Floating chat button (hidden on chat page and mobile) */}
          {!isOnChatPage && (
            <Link
              href="/dashboard/chat"
              className="fixed bottom-20 right-4 z-50 hidden lg:flex h-14 w-14 items-center justify-center rounded-full bg-electric-cyan shadow-lg shadow-electric-cyan/20 transition-all hover:scale-105 hover:shadow-xl hover:shadow-electric-cyan/30 animate-chat-pulse"
              title="Open Boardroom Chat"
            >
              <svg
                className="h-6 w-6 text-deep-space"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
                />
              </svg>
            </Link>
          )}
        </main>

        {/* ─── Mobile Bottom Tab Bar ──────────────────────────────────── */}
        <nav className="fixed bottom-0 left-0 right-0 z-50 flex lg:hidden h-16 items-stretch border-t border-border-glow bg-glass-dark/95 backdrop-blur-lg safe-area-bottom">
          {bottomBarItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium min-h-[44px] ${
                  active ? "text-electric-cyan" : "text-muted-blue"
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        {/* ─── CRT Scanline Overlay ─── */}
        <div className="crt-overlay" />
        {/* ─── Scan Beam ─── */}
        <div className="scan-beam" />
      </div>
    </WelcomeGate>
  );
}
