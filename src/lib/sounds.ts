"use client";

// Sound effects using Web Audio API — no external files needed
// Generates simple tones programmatically (< 1KB total)

let audioContext: AudioContext | null = null;
let soundEnabled = true;

function getContext(): AudioContext {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  return audioContext;
}

export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const saved = localStorage.getItem('gy-sounds');
  if (saved !== null) {
    soundEnabled = saved !== 'off';
  }
  return soundEnabled;
}

export function toggleSound(): boolean {
  soundEnabled = !soundEnabled;
  localStorage.setItem('gy-sounds', soundEnabled ? 'on' : 'off');
  return soundEnabled;
}

function playTone(freq: number, duration: number, type: OscillatorType = 'sine', volume: number = 0.15) {
  if (!isSoundEnabled()) return;
  try {
    const ctx = getContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {
    // silent fail if audio context not available
  }
}

export function playHotLead() {
  playTone(880, 0.3, 'sine', 0.12);
  setTimeout(() => playTone(1100, 0.2, 'sine', 0.08), 150);
}

export function playSwoosh() {
  playTone(400, 0.15, 'sine', 0.08);
  setTimeout(() => playTone(600, 0.25, 'sine', 0.05), 100);
}

export function playWhoosh() {
  playTone(300, 0.2, 'triangle', 0.06);
}

export function playPop() {
  playTone(700, 0.15, 'sine', 0.1);
}

export function playError() {
  playTone(200, 0.3, 'square', 0.06);
}

export function playChime() {
  playTone(660, 0.15, 'sine', 0.1);
  setTimeout(() => playTone(880, 0.2, 'sine', 0.08), 100);
}
