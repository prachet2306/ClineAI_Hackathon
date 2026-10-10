"use client";
// Client-side session store: keeps the latest ingest result and chosen language in plain memory (no storage APIs,
// no library) so the Upload screen and later screens (/report) can share them. It is lost on a full page reload.
import { useSyncExternalStore } from "react";
import type { IngestResult, Language, Report } from "@shared/schemas";

export type Session = {
  result: IngestResult | null;
  language: Language;
  report: Report | null;
  usedMock: string[];
};

const INITIAL: Session = { result: null, language: "en", report: null, usedMock: [] };

let state: Session = INITIAL;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Read the current session (for event handlers and non-React code). */
export function getSession(): Session {
  return state;
}

/** Merge a patch into the session and notify subscribers. */
export function setSession(patch: Partial<Session>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

/** React hook: re-renders when the session changes. */
export function useSession(): Session {
  return useSyncExternalStore(subscribe, getSession, () => INITIAL);
}
