import type { VideoScript } from "./video.functions";

export const W = 1280;
export const H = 720;

const C = {
  bg: "#0f1411",
  panel: "#161d19",
  line: "#243029",
  text: "#e8efe9",
  dim: "#7d8d83",
  accent: "#ffb020",
  green: "#4ade80",
  hl: "rgba(255,176,32,0.14)",
};

export type Segment =
  | { kind: "hook" }
  | { kind: "intro" }
  | { kind: "scene"; index: number }
  | { kind: "output" }
  | { kind: "outro" };

export type Timed = { seg: Segment; start: number; dur: number; text: string };

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function bgLayer(ctx: CanvasRenderingContext2D, t: number) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#0c110e");
  g.addColorStop(1, "#131a15");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,0.03)";
  ctx.lineWidth = 1;
  const off = (t * 10) % 40;
  for (let x = -40 + off; x < W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = -40 + off; y < H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
}

function caption(ctx: CanvasRenderingContext2D, text: string, p: number) {
  // show a moving window of the narration synced with progress
  const words = text.split(/\s+/);
  const idx = Math.floor(p * words.length);
  const startW = Math.max(0, idx - 6);
  const chunk = words.slice(startW, startW + 12);
  ctx.font = "600 24px 'Space Grotesk', sans-serif";
  const lineW = ctx.measureText(chunk.join(" ")).width;
  const x = W / 2 - lineW / 2;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.beginPath();
  ctx.roundRect(x - 18, H - 78, lineW + 36, 46, 10);
  ctx.fill();
  let cx = x;
  chunk.forEach((w, i) => {
    ctx.fillStyle = startW + i === idx ? C.accent : C.text;
    ctx.fillText(w, cx, H - 47);
    cx += ctx.measureText(w + " ").width;
  });
}

function brand(ctx: CanvasRenderingContext2D, title: string) {
  ctx.fillStyle = C.accent;
  ctx.font = "700 18px 'JetBrains Mono', monospace";
  ctx.fillText("</> CodeSamjho", 36, 44);
  ctx.fillStyle = C.dim;
  ctx.font = "500 16px 'Space Grotesk', sans-serif";
  const w = ctx.measureText(title).width;
  ctx.fillText(title, W - 36 - w, 44);
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  script: VideoScript,
  codeLines: string[],
  timeline: Timed[],
  now: number,
) {
  const lastT = timeline[timeline.length - 1];
  const total = lastT ? lastT.start + lastT.dur : 1;
  const cur = timeline.find((s) => now >= s.start && now < s.start + s.dur) ?? timeline[timeline.length - 1];
  bgLayer(ctx, now);
  if (!cur) return;
  const local = now - cur.start;
  const p = Math.min(1, local / cur.dur);
  const inA = ease(local / 0.6);

  if (cur.seg.kind === "hook" || cur.seg.kind === "outro") {
    const big = cur.seg.kind === "hook" ? script.hook : "Samajh aaya? Like + Subscribe!";
    ctx.save();
    ctx.globalAlpha = inA;
    ctx.translate(0, (1 - inA) * 40);
    ctx.fillStyle = C.accent;
    ctx.font = "700 22px 'JetBrains Mono', monospace";
    ctx.fillText(cur.seg.kind === "hook" ? "// wait, yeh dekho" : "// the end", 90, 230);
    ctx.fillStyle = C.text;
    ctx.font = "700 60px 'Space Grotesk', sans-serif";
    wrap(ctx, big, W - 180).slice(0, 4).forEach((l, i) => ctx.fillText(l, 90, 310 + i * 72));
    ctx.restore();
    ctx.fillStyle = C.accent;
    ctx.fillRect(90, 260, 160 * inA, 6);
  } else if (cur.seg.kind === "intro") {
    ctx.globalAlpha = inA;
    ctx.fillStyle = C.dim;
    ctx.font = "600 22px 'JetBrains Mono', monospace";
    ctx.fillText("AAJ KA PROGRAM", 90, 200);
    ctx.fillStyle = C.text;
    ctx.font = "700 54px 'Space Grotesk', sans-serif";
    wrap(ctx, script.title, W - 180).slice(0, 3).forEach((l, i) => ctx.fillText(l, 90, 270 + i * 64));
    ctx.globalAlpha = 1;
  } else if (cur.seg.kind === "scene" || cur.seg.kind === "output") {
    // code panel
    const px = 36, py = 70, pw = 760, ph = 560;
    ctx.fillStyle = C.panel;
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, 14);
    ctx.fill();
    ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(px + 22 + i * 20, py + 22, 6, 0, Math.PI * 2);
      ctx.fill();
    });
    const lh = 26;
    const scene = cur.seg.kind === "scene" ? script.scenes[cur.seg.index] : null;
    const [a, b] = scene ? scene.lines : [1, codeLines.length];
    const visible = Math.floor((ph - 60) / lh);
    const center = (a + b) / 2;
    const first = Math.max(0, Math.min(codeLines.length - visible, Math.round(center - visible / 2)));
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py + 40, pw, ph - 44);
    ctx.clip();
    if (scene) {
      const y = py + 50 + (a - 1 - first) * lh;
      ctx.fillStyle = C.hl;
      ctx.fillRect(px + 4, y, (pw - 8) * inA, (b - a + 1) * lh);
      ctx.fillStyle = C.accent;
      ctx.fillRect(px + 4, y, 4, (b - a + 1) * lh);
    }
    ctx.font = "16px 'JetBrains Mono', monospace";
    for (let i = first; i < Math.min(codeLines.length, first + visible); i++) {
      const y = py + 68 + (i - first) * lh;
      const active = scene ? i + 1 >= a && i + 1 <= b : true;
      ctx.fillStyle = C.dim;
      ctx.fillText(String(i + 1).padStart(3, " "), px + 16, y);
      ctx.fillStyle = active ? C.text : "rgba(232,239,233,0.3)";
      ctx.fillText((codeLines[i] ?? "").replace(/\t/g, "    ").slice(0, 70), px + 60, y);
    }
    ctx.restore();

    // right side
    const rx = 830, rw = W - rx - 36;
    if (scene) {
      ctx.fillStyle = C.accent;
      ctx.font = "700 16px 'JetBrains Mono', monospace";
      ctx.fillText(`STEP ${cur.seg.kind === "scene" ? cur.seg.index + 1 : ""} / ${script.scenes.length}  ·  LINE ${a}${b !== a ? "-" + b : ""}`, rx, 110);
      ctx.fillStyle = C.text;
      ctx.font = "700 32px 'Space Grotesk', sans-serif";
      const hl = wrap(ctx, scene.heading, rw).slice(0, 3);
      hl.forEach((l, i) => ctx.fillText(l, rx, 156 + i * 40));
      let y = 176 + hl.length * 40;
      ctx.font = "500 21px 'Space Grotesk', sans-serif";
      scene.points.forEach((pt, i) => {
        const at = ease((local - 0.8 - i * 1.2) / 0.5);
        if (at <= 0) return;
        ctx.globalAlpha = at;
        ctx.fillStyle = C.green;
        ctx.fillText("→", rx + (1 - at) * 20, y);
        ctx.fillStyle = C.text;
        const ls = wrap(ctx, pt, rw - 30);
        ls.forEach((l, j) => ctx.fillText(l, rx + 30 + (1 - at) * 20, y + j * 28));
        y += ls.length * 28 + 22;
        ctx.globalAlpha = 1;
      });
    } else {
      ctx.fillStyle = C.green;
      ctx.font = "700 16px 'JetBrains Mono', monospace";
      ctx.fillText("OUTPUT", rx, 110);
      ctx.fillStyle = "#050806";
      ctx.beginPath();
      ctx.roundRect(rx, 130, rw, 380, 12);
      ctx.fill();
      ctx.fillStyle = C.green;
      ctx.font = "17px 'JetBrains Mono', monospace";
      const out = script.output.split("\n").flatMap((l) => wrap(ctx, l || " ", rw - 40));
      const shown = Math.floor(ease(p * 1.6) * out.length + 0.999);
      out.slice(0, Math.min(shown, 14)).forEach((l, i) => ctx.fillText(l, rx + 20, 170 + i * 26));
    }
  }

  brand(ctx, script.title.slice(0, 50));
  caption(ctx, cur.text, p);
  ctx.fillStyle = C.line;
  ctx.fillRect(0, H - 6, W, 6);
  ctx.fillStyle = C.accent;
  ctx.fillRect(0, H - 6, W * (now / total), 6);
}

export function buildSegments(script: VideoScript): { seg: Segment; text: string }[] {
  return [
    { seg: { kind: "hook" }, text: script.hook },
    { seg: { kind: "intro" }, text: script.intro },
    ...script.scenes.map((s, index) => ({ seg: { kind: "scene", index } as Segment, text: s.narration })),
    { seg: { kind: "output" }, text: `Chalo ab dekhte hain output kya aayega. ${script.output.replace(/\n/g, ", ").slice(0, 300)}` },
    { seg: { kind: "outro" }, text: script.outro },
  ];
}
