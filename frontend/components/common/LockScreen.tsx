"use client";
import { Lock, ScanFace } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Input } from "@/components/ui";
import { useCamera } from "@/hooks/useCamera";
import { api } from "@/lib/api";

/** Full-screen lock shown when the server reports the session is locked (idle timeout or manual lock). */
export function LockScreen({ name, email, onUnlocked }: { name: string; email?: string; onUnlocked: () => void }) {
  const cam = useCamera();
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [usePin, setUsePin] = useState(false);

  const [faceOn, setFaceOn] = useState<boolean | null>(null);
  useEffect(() => {
    // The PIN always unlocks. The camera only opens when a face is enrolled.
    api.get<{ enrolled: boolean; available: boolean }>("/face/status").then((s) => {
      const on = s.enrolled && s.available;
      setFaceOn(on);
      if (on) cam.start(); else setUsePin(true);
    }).catch(() => { setFaceOn(false); setUsePin(true); });
    return cam.stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function faceUnlock() {
    const image = cam.snap();
    if (!image) return setMsg("Camera isn't ready yet.");
    setBusy(true);
    setMsg("");
    try {
      await api.post("/face/verify", { image });
      cam.stop();
      onUnlocked();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function pinUnlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      await api.post("/auth/unlock", { pin });
      cam.stop();
      onUnlocked();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-background/95 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Locked">
      <div className="w-full max-w-sm space-y-4 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-primary text-primary-foreground"><Lock className="h-6 w-6" /></span>
        <div>
          <h2 className="text-xl font-bold">RubiCore is locked</h2>
          <p className="text-sm text-muted-foreground">Welcome back, {name.split(" ")[0]}. Unlock with your face or PIN to continue.</p>
          {email && <p className="mt-0.5 text-xs text-muted-foreground">{email}</p>}
        </div>
        {faceOn && (
          <>
            <div className="overflow-hidden rounded-xl border bg-muted">
              <video ref={cam.videoRef} muted playsInline className="aspect-[4/3] w-full -scale-x-100 object-cover" />
            </div>
            {cam.error && (
              <div className="space-y-1.5"><p className="text-sm text-danger">{cam.error}</p><button type="button" className="text-sm font-medium text-primary" onClick={() => cam.start()}>Try camera again</button></div>
            )}
          </>
        )}
        {msg && <p className="text-sm text-danger" role="alert">{msg}</p>}
        {faceOn && <Button className="w-full" onClick={faceUnlock} disabled={busy || !cam.ready}><ScanFace className="h-4 w-4" />{busy ? "Checking…" : "Unlock with face"}</Button>}
        {usePin ? (
          <form onSubmit={pinUnlock} className="flex gap-2">
            <Input type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))} placeholder="PIN" maxLength={12} aria-label="PIN" />
            <Button type="submit" variant="outline" disabled={busy || !pin}>Unlock</Button>
          </form>
        ) : (
          faceOn && <button className="text-sm text-primary" onClick={() => setUsePin(true)}>Use PIN instead</button>
        )}
      </div>
    </div>
  );
}
