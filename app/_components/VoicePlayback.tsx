"use client";

import { useRef, useState } from "react";
import type { PreferredLanguage } from "@/data/seed/schema";

// Phase 9.3: pre-rendered audio is the primary path (reliable for a recorded
// demo video), live browser SpeechSynthesis is the fallback (interactive,
// works everywhere, no TTS credential required). See docs/BLOCKERS.md for
// why no pre-rendered file exists yet in this environment — no TTS provider
// key was among Phase 0's provisioned credentials. Drop an MP3 at
// public/audio/demo_case_<id>.mp3 and this component picks it up automatically.
export function VoicePlayback({ caseId, messageText, language }: { caseId: string; messageText?: string; language: PreferredLanguage }) {
  const [status, setStatus] = useState<"idle" | "playing" | "unavailable">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  if (!messageText) return null;

  async function play() {
    setStatus("playing");
    const preRenderedUrl = `/audio/demo_case_${caseId}.mp3`;
    const hasPreRendered = await fetch(preRenderedUrl, { method: "HEAD" }).then((r) => r.ok).catch(() => false);

    if (hasPreRendered) {
      const audio = audioRef.current ?? new Audio(preRenderedUrl);
      audioRef.current = audio;
      audio.src = preRenderedUrl;
      audio.onended = () => setStatus("idle");
      await audio.play();
      return;
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(messageText);
      utterance.lang = language === "hi-en" ? "hi-IN" : "en-IN";
      utterance.onend = () => setStatus("idle");
      utterance.onerror = () => setStatus("idle");
      window.speechSynthesis.speak(utterance);
    } else {
      setStatus("unavailable");
    }
  }

  return (
    <div className="mt-3 flex items-center gap-2 text-xs text-navy-muted">
      <button
        onClick={play}
        disabled={status === "playing"}
        className="rounded-md bg-ink-navy-raised px-3 py-1.5 text-navy-text hover:brightness-110 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass-gold"
      >
        {status === "playing" ? "Playing…" : "▶ Play voice preview"}
      </button>
      <span>simulated voice · pre-rendered file if available, else live browser speech</span>
      {status === "unavailable" && <span className="text-stamp-rust">Speech synthesis isn&apos;t available in this browser.</span>}
    </div>
  );
}
