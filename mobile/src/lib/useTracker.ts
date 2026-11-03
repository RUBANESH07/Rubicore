import { useEffect, useState, useSyncExternalStore } from "react";
import { getState, subscribe, TrackerState } from "./tracker";

export function useTracker(): TrackerState & { elapsedSeconds: number; signal: "none" | "searching" | "good" | "fair" | "poor" | "lost" } {
  const s = useSyncExternalStore(subscribe, getState, getState);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const running = s.phase === "active" || s.phase === "paused";
  const elapsedMs = !running || !s.startedAt ? 0 : (s.phase === "paused" && s.pauseAt ? s.pauseAt : now) - s.startedAt - s.pausedMs;
  const age = s.lastFixAt ? (now - s.lastFixAt) / 1000 : null;
  const signal = !running ? "none" : !s.fix ? "searching" : s.phase === "active" && age != null && age > 15 ? "lost" : (s.accuracy ?? 99) <= 15 ? "good" : (s.accuracy ?? 99) <= 50 ? "fair" : "poor";
  return { ...s, elapsedSeconds: Math.max(0, elapsedMs / 1000), signal };
}
