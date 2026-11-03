"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Webcam access. Needs https or localhost. Frames are only sent when the user presses a button. */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  const start = useCallback(async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't access a camera here (https or localhost is required).");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 640, height: 480 }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setReady(true);
    } catch (e: any) {
      setError(e?.name === "NotAllowedError" ? "Camera is blocked for this site. Click the camera or lock icon in the address bar, set Camera to Allow, then press Try camera again."
        : e?.name === "NotFoundError" ? "No camera was found on this device." : e?.name === "NotReadableError" ? "The camera is in use by another app. Close it and try again." : "Couldn't start the camera.");
    }
  }, []);

  useEffect(() => stop, [stop]);

  /** Current frame as a JPEG data URL (max 480px wide). */
  const snap = useCallback((): string | null => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const w = Math.min(480, v.videoWidth), h = Math.round((v.videoHeight / v.videoWidth) * w);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")!.drawImage(v, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.85);
  }, []);

  return { videoRef, ready, error, start, stop, snap };
}
