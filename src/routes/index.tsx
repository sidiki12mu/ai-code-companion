import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { generateScript, synthesize, type VideoScript } from "@/lib/video.functions";
import { buildSegments, drawFrame, H, W, type Timed } from "@/lib/renderer";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CodeSamjho — Code daalo, explanation video pao" },
      { name: "description", content: "C, HTML, Python ka code paste karo aur Hinglish voiceover wala YouTube-ready explanation video banao." },
      { property: "og:title", content: "CodeSamjho — Code daalo, explanation video pao" },
      { property: "og:description", content: "Hinglish voiceover ke saath AI programming explanation videos, seedha YouTube ke liye." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const SAMPLE = `#include <stdio.h>

int main() {
    int n, i, sum = 0;
    printf("Enter a number: ");
    scanf("%d", &n);

    for (i = 1; i <= n; i++) {
        sum = sum + i;
    }

    printf("Sum = %d\\n", sum);
    return 0;
}`;

type Phase = "idle" | "script" | "voice" | "ready" | "playing" | "recording";

function Index() {
  const [code, setCode] = useState(SAMPLE);
  const [language, setLanguage] = useState("C");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [script, setScript] = useState<VideoScript | null>(null);
  const [download, setDownload] = useState<{ url: string; ext: string } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const buffers = useRef<AudioBuffer[]>([]);
  const timeline = useRef<Timed[]>([]);
  const codeLinesRef = useRef<string[]>([]);
  const stopRef = useRef<() => void>(() => {});
  const genScript = useServerFn(generateScript);
  const genVoice = useServerFn(synthesize);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#0f1411";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#7d8d83";
    ctx.font = "600 28px 'Space Grotesk', sans-serif";
    ctx.fillText("Tumhara video yahan banega…", 80, H / 2);
  }, []);

  async function create() {
    setError("");
    setDownload(null);
    try {
      setPhase("script");
      setProgress("AI script likh raha hai…");
      const s = await genScript({ data: { code, language } });
      setScript(s);
      codeLinesRef.current = code.split("\n");
      setPhase("voice");
      const segs = buildSegments(s);
      const ac = audioCtx.current ?? new AudioContext();
      audioCtx.current = ac;
      const out: AudioBuffer[] = new Array(segs.length);
      let done = 0;
      setProgress(`Voiceover ban raha hai… 0/${segs.length}`);
      let next = 0;
      const worker = async () => {
        while (next < segs.length) {
          const i = next++;
          const { audio } = await genVoice({ data: { text: segs[i]!.text } });
          const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
          out[i] = await ac.decodeAudioData(bytes.buffer);
          done++;
          setProgress(`Voiceover ban raha hai… ${done}/${segs.length}`);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      buffers.current = out;
      let t = 0;
      timeline.current = segs.map((sg, i) => {
        const dur = out[i]!.duration + 0.6;
        const item = { ...sg, start: t, dur };
        t += dur;
        return item;
      });
      const ctx = canvasRef.current!.getContext("2d")!;
      drawFrame(ctx, s, codeLinesRef.current, timeline.current, 0.01);
      setPhase("ready");
      setProgress(`Video ready — ${Math.round(t / 60)} min ${Math.round(t % 60)} sec`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kuch galat ho gaya");
      setPhase(script ? "ready" : "idle");
    }
  }

  async function play(record: boolean) {
    if (!script || !audioCtx.current) return;
    const ac = audioCtx.current;
    await ac.resume();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const dest = ac.createMediaStreamDestination();
    const t0 = ac.currentTime + 0.2;
    const sources = timeline.current.map((seg, i) => {
      const src = ac.createBufferSource();
      src.buffer = buffers.current[i] ?? null;
      src.connect(ac.destination);
      if (record) src.connect(dest);
      src.start(t0 + seg.start + 0.3);
      return src;
    });
    const last = timeline.current[timeline.current.length - 1]!;
    const total = last.start + last.dur + 0.5;

    let recorder: MediaRecorder | null = null;
    const chunks: Blob[] = [];
    let ext = "webm";
    if (record) {
      const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const types = ["video/mp4;codecs=avc1,mp4a", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];
      const mime = types.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      ext = mime.includes("mp4") ? "mp4" : "webm";
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mime || "video/webm" });
        setDownload({ url: URL.createObjectURL(blob), ext });
      };
      recorder.start(1000);
    }
    setPhase(record ? "recording" : "playing");
    let raf = 0;
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      sources.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } });
      recorder?.stop();
      setPhase("ready");
    };
    stopRef.current = stop;
    const loop = () => {
      const now = ac.currentTime - t0;
      drawFrame(ctx, script, codeLinesRef.current, timeline.current, Math.max(0.01, now));
      if (now >= total) return stop();
      raf = requestAnimationFrame(loop);
    };
    loop();
  }

  const busy = phase === "script" || phase === "voice";
  const running = phase === "playing" || phase === "recording";

  return (
    <main className="min-h-screen bg-background text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <div className="text-lg font-bold text-primary" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          {"</>"} CodeSamjho
        </div>
        <span className="text-sm text-muted-foreground">Code daalo → Hinglish video pao</span>
      </header>

      <section className="mx-auto max-w-7xl px-6 pb-4">
        <h1 className="text-4xl font-bold leading-tight md:text-5xl">
          Koi bhi program, <span className="text-primary">ekdum easy video</span> mein.
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Apna C, HTML ya Python code paste karo. AI line-by-line samjhayega, Hinglish mein bolega, aur tum video download karke seedha YouTube pe daal sakte ho.
        </p>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-6 pb-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            {["C", "C++", "HTML", "Python", "Java", "JavaScript"].map((l) => (
              <button
                key={l}
                onClick={() => setLanguage(l)}
                className={`rounded-md border px-3 py-1.5 text-sm ${language === l ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                {l}
              </button>
            ))}
          </div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            className="h-[420px] w-full resize-none rounded-lg border border-border bg-card p-4 text-sm text-card-foreground outline-none focus:border-primary"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
            placeholder="Yahan apna code paste karo…"
          />
          <button
            onClick={create}
            disabled={busy || running || code.trim().length < 5}
            className="rounded-lg bg-primary px-5 py-3 text-lg font-bold text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Ban raha hai…" : "Video banao"}
          </button>
          <p className="text-xs text-muted-foreground">Chhota program ~1 minute mein, bada program 2-3 minute mein ready hota hai.</p>
        </div>

        <div className="flex flex-col gap-3">
          <canvas ref={canvasRef} width={W} height={H} className="aspect-video w-full rounded-lg border border-border" />
          <div className="min-h-6 text-sm">
            {progress && <span className="text-accent">{progress}</span>}
            {error && <p className="text-destructive">{error}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => play(false)}
              disabled={phase !== "ready"}
              className="rounded-lg border border-border px-4 py-2 font-semibold disabled:opacity-40"
            >
              ▶ Preview dekho
            </button>
            <button
              onClick={() => play(true)}
              disabled={phase !== "ready"}
              className="rounded-lg bg-accent px-4 py-2 font-semibold text-accent-foreground disabled:opacity-40"
            >
              ● Video record karo
            </button>
            {running && (
              <button onClick={() => stopRef.current()} className="rounded-lg border border-destructive px-4 py-2 text-destructive">
                ■ Stop
              </button>
            )}
            {download && (
              <a
                href={download.url}
                download={`${(script?.title ?? "video").replace(/[^\w]+/g, "-")}.${download.ext}`}
                className="rounded-lg bg-primary px-4 py-2 font-bold text-primary-foreground"
              >
                ⬇ Download video
              </a>
            )}
          </div>
          {phase === "recording" && (
            <p className="text-sm text-muted-foreground">Recording chal rahi hai — video poora chalne do, yeh tab khula rakho.</p>
          )}
          {script && (
            <details className="rounded-lg border border-border bg-card p-4 text-sm">
              <summary className="cursor-pointer font-semibold">YouTube title + script dekho</summary>
              <p className="mt-3 font-bold text-primary">{script.title}</p>
              <p className="mt-2 italic">{script.hook}</p>
              {script.scenes.map((s, i) => (
                <p key={i} className="mt-2 text-muted-foreground">
                  <b className="text-foreground">{i + 1}. {s.heading}:</b> {s.narration}
                </p>
              ))}
            </details>
          )}
        </div>
      </section>
    </main>
  );
}
