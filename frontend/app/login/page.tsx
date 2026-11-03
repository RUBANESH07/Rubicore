"use client";
import { Delete, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FaceSignIn } from "@/components/common/FaceSignIn";
import { Card } from "@/components/ui";
import { api } from "@/lib/api";

const PIN_LEN = 4;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

/** The only way in: the PIN (default 1224, APP_PIN on the server) or an enrolled face. No accounts, no passwords. */
export default function LoginPage() {
  const router = useRouter();
  const [digits, setDigits] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [faceLogin, setFaceLogin] = useState(false);

  useEffect(() => {
    api.get<{ face_login: boolean }>("/auth/options").then((o) => setFaceLogin(o.face_login)).catch(() => {});
  }, []);

  async function submit(pin: string) {
    setBusy(true);
    setErr("");
    try {
      await api.post("/auth/pin", { pin });
      router.replace("/dashboard");
    } catch (e: any) {
      setErr(e.message);
      setDigits("");
    } finally {
      setBusy(false);
    }
  }

  function press(k: string) {
    if (busy || !k) return;
    if (k === "del") return setDigits((d) => d.slice(0, -1));
    const next = (digits + k).slice(0, PIN_LEN);
    setDigits(next);
    setErr("");
    if (next.length === PIN_LEN) void submit(next);
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("del");
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-primary text-primary-foreground"><Sparkles className="h-6 w-6" /></span>
          <h1 className="text-2xl font-bold tracking-tight">RubiCore</h1>
          <p className="mt-1 text-sm text-muted-foreground">Track Your Day. Understand Your Money. Explore the World.</p>
        </div>
        <Card className="space-y-4 p-6">
          {faceLogin && (
            <>
              <FaceSignIn onSignedIn={() => router.replace("/dashboard")} />
              <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or enter your PIN<span className="h-px flex-1 bg-border" /></div>
            </>
          )}
          <h2 className="text-center font-semibold">Enter your PIN</h2>
          <div className="flex justify-center gap-3" aria-label={`${digits.length} of ${PIN_LEN} digits entered`}>
            {Array.from({ length: PIN_LEN }).map((_, i) => (
              <span key={i} className={`h-3.5 w-3.5 rounded-full border-2 border-primary ${i < digits.length ? "bg-primary" : ""}`} />
            ))}
          </div>
          <p className="min-h-5 text-center text-sm text-danger" role="alert">{err}</p>
          <div className="mx-auto grid max-w-[15rem] grid-cols-3 gap-3">
            {KEYS.map((k, i) => k ? (
              <button key={i} type="button" onClick={() => press(k)} disabled={busy} aria-label={k === "del" ? "Delete" : k}
                className="grid h-14 place-items-center rounded-full border bg-card text-xl font-medium transition hover:bg-muted disabled:opacity-50">
                {k === "del" ? <Delete className="h-5 w-5" /> : k}
              </button>
            ) : <span key={i} />)}
          </div>
        </Card>
      </div>
    </div>
  );
}
