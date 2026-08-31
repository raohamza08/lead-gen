"use client";

/**
 * Short, synthesized notification tones via the Web Audio API (Part:
 * Desktop notifications, 2026-08-31) — no external audio files, so no
 * licensing/asset weight, and every tone is a ~10-line pure function.
 * Browsers suspend a fresh AudioContext until a user gesture happens
 * anywhere on the page (autoplay policy) — call `unlockNotificationAudio()`
 * from the first click/keydown the app sees; playing a tone before that
 * silently no-ops rather than throwing.
 */
export type SoundTone = "DEFAULT" | "SOFT" | "PROFESSIONAL" | "MINIMAL" | "ALERT" | "NONE";

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

export function unlockNotificationAudio(): void {
  const c = getContext();
  if (c?.state === "suspended") c.resume().catch(() => undefined);
}

function playTone(freqs: number[], durationMs: number, type: OscillatorType, gap = 0.08) {
  const c = getContext();
  if (!c || c.state === "suspended") return; // not unlocked yet — silently skip, never throw
  const now = c.currentTime;
  freqs.forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const start = now + i * gap;
    const end = start + durationMs / 1000;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.12, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  });
}

/** Each tone is deliberately short (well under a second) and quiet — a
 *  notification sound that outstays its welcome gets muted by users
 *  entirely, which defeats the point. */
export function playNotificationTone(tone: SoundTone): void {
  switch (tone) {
    case "NONE":
      return;
    case "SOFT":
      playTone([659.25], 260, "sine");
      return;
    case "PROFESSIONAL":
      playTone([523.25, 659.25], 260, "sine");
      return;
    case "MINIMAL":
      playTone([880], 70, "sine");
      return;
    case "ALERT":
      playTone([880, 880], 130, "square");
      return;
    case "DEFAULT":
    default:
      playTone([523.25, 783.99], 200, "triangle");
      return;
  }
}
