"use client";
import { ScanFace } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";
import { useCamera } from "@/hooks/useCamera";
import { api } from "@/lib/api";

/** Face sign-in on the PIN page: tap, the camera opens, one scan opens the app. The PIN stays available. */
export function FaceSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const cam = useCamera();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function begin() {
    setOpen(true);
    setMsg("");
    await cam.start();
  }
  function cancel() {
    cam.stop();
    setOpen(false);
    setMsg("");
  }
  async function scan() {
    const image = cam.snap();
    if (!image) return setMsg("Camera isn't ready yet.");
    setBusy(true);
    setMsg("");
    try {
      await api.post("/face/login", { image });
      cam.stop();
      onSignedIn();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <Button type="button" variant="outline" className="w-full" onClick={begin}><ScanFace className="h-4 w-4" />Sign in with face</Button>;
  }
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border bg-muted">
        <video ref={cam.videoRef} muted playsInline className="aspect-[4/3] w-full -scale-x-100 object-cover" />
      </div>
      {cam.error && (
        <div className="space-y-1.5"><p className="text-sm text-danger">{cam.error}</p><button type="button" className="text-sm font-medium text-primary" onClick={() => cam.start()}>Try camera again</button></div>
      )}
      {msg && <p className="text-sm text-danger" role="alert">{msg}</p>}
      <p className="text-center text-xs text-muted-foreground">Look straight at the camera in good light, then press Scan.</p>
      <Button type="button" className="w-full" onClick={scan} disabled={busy || !cam.ready}><ScanFace className="h-4 w-4" />{busy ? "Checking…" : "Scan my face"}</Button>
      <button type="button" className="block w-full text-center text-sm text-primary" onClick={cancel}>Use PIN instead</button>
    </div>
  );
}
