"use client";
import { ScanFace, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { SectionTitle } from "@/components/common/states";
import { Badge, Button, Card, Dialog, Input, Label, Switch } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";
import { useCamera } from "@/hooks/useCamera";
import { api } from "@/lib/api";

const SHOTS = 6;
const PROMPTS = ["Look straight at the camera", "Turn slightly left", "Turn slightly right", "Tilt your head a little", "Look straight again", "Smile"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function FaceLockCard({ onChange }: { onChange?: () => void }) {
  const status = useFetch<{ enrolled: boolean; available: boolean; allow_login: boolean }>("/face/status");
  const cam = useCamera();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [allowLogin, setAllowLogin] = useState(true);
  const [step, setStep] = useState(-1);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [welcome, setWelcome] = useState(false);
  useEffect(() => {
    // Opened with ?setup=face: offer to enroll right away.
    if (new URLSearchParams(window.location.search).get("setup") === "face") setWelcome(true);
  }, []);

  const close = () => { cam.stop(); setOpen(false); setPin(""); setMsg(""); setStep(-1); };

  async function enroll() {
    setMsg("");
    setBusy(true);
    const images: string[] = [];
    for (let i = 0; i < SHOTS; i++) {
      setStep(i);
      await sleep(1300);
      const s = cam.snap();
      if (s) images.push(s);
    }
    setStep(-1);
    try {
      await api.post("/face/enroll", { pin, images, allow_login: allowLogin });
      close();
      status.reload();
      onChange?.();
      window.dispatchEvent(new Event("rp-face-changed"));
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const p = prompt("Enter your PIN to remove face lock");
    if (!p) return;
    try { await api.post("/face/remove", { pin: p }); status.reload(); onChange?.(); window.dispatchEvent(new Event("rp-face-changed")); } catch (e: any) { alert(e.message); }
  }

  async function toggleLogin(next: boolean) {
    const p = prompt(next ? "Enter your PIN to allow opening the app with your face" : "Enter your PIN to turn off face sign-in");
    if (!p) return;
    try { await api.post("/face/login-setting", { pin: p, allow_login: next }); status.reload(); window.dispatchEvent(new Event("rp-face-changed")); } catch (e: any) { alert(e.message); }
  }

  const enrolled = status.data?.enrolled;
  return (
    <Card>
      <SectionTitle title="Face lock" right={enrolled ? <Badge tone="success">Enrolled</Badge> : <Badge>Off</Badge>} />
      <p className="mb-3 text-sm text-muted-foreground">
        Lock RubiCore after {10} idle minutes (or on demand) and unlock with your face or your PIN.
        Your PIN is still required to enroll or remove your face.
      </p>
      <div className="mb-3 flex items-start gap-2 rounded-md bg-warning/10 p-2 text-xs text-warning">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Convenience lock, not strong security: there is no liveness check, so a photo of you may fool it. Face data is stored encrypted on the server.</span>
      </div>
      {welcome && !enrolled && (
        <p className="mb-3 rounded-md bg-primary/10 p-2 text-sm">Want to add face lock? Enter your PIN to enroll, or skip: the PIN always works.</p>
      )}
      {status.data && !status.data.available && (
        <p className="mb-3 text-sm text-danger">Face recognition isn't installed on the server yet (see the README, face lock setup).</p>
      )}
      {enrolled && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
          <div><div className="font-medium">Open with face</div><div className="text-xs text-muted-foreground">Shows a face button on the PIN page. The PIN always still works.</div></div>
          <Switch checked={!!status.data?.allow_login} onChange={toggleLogin} />
        </div>
      )}
      <div className="flex gap-2">
        <Button disabled={status.data ? !status.data.available : false} onClick={() => setOpen(true)}><ScanFace className="h-4 w-4" />{enrolled ? "Re-enroll face" : "Enroll face"}</Button>
        {enrolled && <Button variant="outline" onClick={remove}>Remove</Button>}
      </div>

      <Dialog open={open} onClose={close} title="Enroll your face">
        <div className="space-y-3">
          <div className="overflow-hidden rounded-xl border bg-muted">
            <video ref={cam.videoRef} muted playsInline className="aspect-[4/3] w-full -scale-x-100 object-cover" />
          </div>
          {cam.error && <p className="text-sm text-danger">{cam.error}</p>}
          {step >= 0 && <p className="text-center text-sm font-medium" role="status">{PROMPTS[step]} ({step + 1}/{SHOTS})</p>}
          {!cam.ready ? (
            <Button className="w-full" onClick={cam.start}>Start camera</Button>
          ) : (
            <>
              <div><Label>Confirm your PIN</Label><Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))} maxLength={12} autoComplete="off" /></div>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={allowLogin} onChange={(e) => setAllowLogin(e.target.checked)} /><span>Also let me <b>open the app</b> with my face on the PIN page (no PIN needed). Without a liveness check, a photo of you could work, so keep this off if others can get your photo.</span></label>
              <p className="text-xs text-muted-foreground">One person in frame, face well lit. We'll take {SHOTS} photos about a second apart.</p>
              {msg && <p className="text-sm text-danger" role="alert">{msg}</p>}
              <Button className="w-full" disabled={busy || !pin} onClick={enroll}>{busy ? "Capturing…" : "Capture and enroll"}</Button>
            </>
          )}
        </div>
      </Dialog>
    </Card>
  );
}
