import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Loader2 } from "lucide-react";

/** Opens the rear camera and calls onResult once with the first QR code text it reads. */
export function QrScanner({ onResult }: { onResult: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const tick = () => {
      const v = videoRef.current;
      if (cancelled || doneRef.current || !v || !ctx) return;
      if (v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth > 0) {
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        if (code?.data) {
          doneRef.current = true;
          onResult(code.data);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera not available. Open this page over HTTPS in your phone browser.");
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        v.setAttribute("playsinline", "true");
        await v.play();
        setReady(true);
        raf = requestAnimationFrame(tick);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Camera error";
        setError(/denied|permission|NotAllowed/i.test(msg) ? "Camera permission was denied. Allow camera access and try again." : msg);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-2xl bg-black">
      <video ref={videoRef} className="size-full object-cover" muted playsInline />
      {!ready && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-white/80">
          <Loader2 className="size-6 animate-spin" />
        </div>
      )}
      {ready && <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-white/70" />}
      {error && <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white">{error}</p>}
    </div>
  );
}
