import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev";

export type Scene = {
  heading: string;
  lines: [number, number];
  narration: string;
  points: string[];
};
export type VideoScript = {
  title: string;
  hook: string;
  intro: string;
  scenes: Scene[];
  output: string;
  outro: string;
};

const PROMPT = `Tum ek super-friendly Indian YouTube coding teacher ho jo BCA/college students ko programs samjhata hai.
User ka code diya gaya hai (line numbers ke saath). Iska ek long-form explanation video script banao HINGLISH mein (Hindi + English mix, ROMAN script mein, Devanagari NAHI).
Style: bade bhai jaisa, energetic, simple examples (chai, cricket, dukaan), har confusing cheez clearly. Technical words English mein rakho.
Rules:
- 6 se 12 scenes. Code ko upar se neeche cover karo, har scene 1-6 lines ka.
- Har narration 50-110 words ka, bolne layak, jaise viewer se baat kar rahe ho. Symbols bolke likho (jaise "less than", "plus plus").
- points: 2-3 chhote on-screen bullets (max 6 words each).
- hook: 1 line jo pehle 5 second mein viewer rok de (curiosity/relatable problem).
- intro: 40-60 words narration: program kya karega.
- output: program ka expected output (plain text, jaise terminal mein dikhega; HTML ho to browser mein kya dikhega woh describe karo).
- outro: 30-50 words: summary + "video pasand aaya to like, subscribe" + ek practice challenge.
Sirf JSON do, is shape mein:
{"title":"...","hook":"...","intro":"...","scenes":[{"heading":"...","lines":[startLine,endLine],"narration":"...","points":["..."]}],"output":"...","outro":"..."}`;

export const generateScript = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ code: z.string().min(5).max(8000), language: z.string().max(40) }).parse(d),
  )
  .handler(async ({ data }): Promise<VideoScript> => {
    const key = process.env['LOVABLE_API_KEY'];
    if (!key) throw new Error("AI setup missing");
    const numbered = data.code
      .split("\n")
      .map((l, i) => `${i + 1}: ${l}`)
      .join("\n");
    const res = await fetch(`${GATEWAY}/v1/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        instructions: PROMPT,
        input: `Return only valid json.\nLanguage: ${data.language}\n\nCode:\n${numbered}`,
        text: { format: { type: "json_object" } },
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      if (res.status === 429) throw new Error("Abhi bahut requests aa rahi hain, thodi der baad try karo.");
      if (res.status === 402) throw new Error("AI credits khatam ho gaye hain. Workspace mein credits add karo.");
      throw new Error(`Script nahi ban payi (${res.status}): ${t.slice(0, 200)}`);
    }
    const json = await res.json();
    const text: string =
      json.output_text ??
      (json.output ?? [])
        .filter((o: { type: string }) => o.type === "message")
        .flatMap((o: { content: { text?: string }[] }) => o.content.map((c) => c.text ?? ""))
        .join("");
    if (!text) throw new Error("AI ne koi jawab nahi diya, code thoda badal ke try karo.");
    const parsed = JSON.parse(text) as VideoScript;
    const max = data.code.split("\n").length;
    parsed.scenes = (parsed.scenes ?? []).map((s) => {
      const a = Math.max(1, Math.min(max, Number(s.lines?.[0]) || 1));
      const b = Math.max(a, Math.min(max, Number(s.lines?.[1]) || a));
      return { ...s, lines: [a, b], points: (s.points ?? []).slice(0, 3) };
    });
    return parsed;
  });

export const synthesize = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ text: z.string().min(1).max(3000) }).parse(d))
  .handler(async ({ data }): Promise<{ audio: string }> => {
    const key = process.env['LOVABLE_API_KEY'];
    if (!key) throw new Error("AI setup missing");
    const res = await fetch(`${GATEWAY}/v1/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-tts-preview",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Read this in a friendly, energetic Indian YouTuber voice, Hinglish accent, clear and slightly fast: ${data.text}`,
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
        },
        stream_format: "audio",
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Voice nahi ban payi (${res.status}): ${t.slice(0, 200)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { audio: buf.toString("base64") };
  });
