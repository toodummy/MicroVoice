import * as ort from "./vendor/ort.wasm.min.mjs";
import { EspeakNG } from "@pipedog/espeak-ng/espeak";
import createEspeakModule from "@echogarden/espeak-ng-emscripten";
import { XzReadableStream } from "xz-decompress";
import { japanesePhonemes } from "./japanese.mjs";

const MAX_PHONES = 350;
const STYLE_WIDTH = 256;
const RUNTIME = new URL("./vendor/", import.meta.url);
const MODELS = new URL("./model/", import.meta.url);
const SPEECH = /[\p{L}\p{N}]/u;
const SENTENCE_BREAK = /(?<=[.!?…])\s+|(?<=[。！？])|\n+/u;
const ESPEAK_CODES = { en: "en-us", ru: "ru", es: "es", fr: "fr-fr", de: "de", ko: "ko", it: "it", pt: "pt-br", zh: "cmn" };
const TIES = [
  ["aɪ", "I"], ["aʊ", "W"], ["dʒ", "ʤ"], ["eɪ", "A"], ["oʊ", "O"],
  ["əʊ", "Q"], ["tʃ", "ʧ"], ["ɔɪ", "Y"],
];
const styles = new Map();
let ortReady;
let espeak;
let activeModel;
let vocabulary;
let mandarinConfig;

const octets = (data) => new Uint8Array(data);
const status = (message) => self.postMessage({ type: "status", message });

async function asset(base, path) {
  const response = await fetch(new URL(path, base));
  if (!response.ok || response.body === null) throw new Error(`Could not download ${path} (HTTP ${response.status}).`);
  return response;
}

async function downloadModel(path) {
  const response = await asset(MODELS, path);
  const total = Number(response.headers.get("content-length"));
  let bytes = 0;
  let lastReport = 0;
  const progress = new TransformStream({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes - lastReport >= 2_000_000) {
        lastReport = bytes;
        const goal = total > 0 ? ` / ${Math.round(total / 1_000_000)}` : "";
        status(`Downloading model · ${Math.round(bytes / 1_000_000)}${goal} MB`);
      }
      controller.enqueue(chunk);
    },
  });
  const decompressed = response.body.pipeThrough(progress).pipeThrough(new DecompressionStream("gzip"));
  return new Response(decompressed).arrayBuffer();
}

async function gzipAsset(path) {
  const response = await asset(RUNTIME, path);
  return new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}

async function configureOrt() {
  ort.env.logLevel = "error";
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = { mjs: new URL("ort-wasm-simd-threaded.mjs", RUNTIME).href };
  ort.env.wasm.wasmBinary = await gzipAsset("ort.wasm.gz");
}

async function modelFor(lang) {
  const family = lang === "zh" ? "mandarin" : "kitten";
  if (activeModel?.family === family) return activeModel.session;
  if (activeModel) {
    await activeModel.session.release();
    activeModel = undefined;
  }
  status("Loading the on-device model…");
  ortReady ??= configureOrt().catch((error) => {
    ortReady = undefined;
    throw error;
  });
  const [graph] = await Promise.all([downloadModel(`${family}.onnx.gz`), ortReady]);
  status("Starting the model in WebAssembly…");
  const session = await ort.InferenceSession.create(octets(graph), { executionProviders: ["wasm"] });
  activeModel = { family, session };
  return session;
}

async function phonemizer(lang) {
  if (!espeak) {
    status("Loading pronunciation data…");
    const data = await gzipAsset("espeak-ng.data.gz");
    const wasm = await createEspeakModule({
      getPreloadedPackage: () => data,
      print: () => {},
      printErr: () => {},
    });
    espeak = new EspeakNG(wasm);
  }
  espeak.setVoice(ESPEAK_CODES[lang], { by: "language" });
  return espeak;
}

function normalize(text, lang) {
  let clean = text.normalize("NFC").trim().replace(/\r\n?/g, "\n").replace(/\.{3,}/g, "…");
  if (lang === "en") {
    clean = clean.replace(/\b(Mr|Mrs|Ms|Dr|Prof|St)\.(?=\s+\p{L})/giu, "$1");
    clean = clean.replace(/\$(\d{1,10})(?:\.(\d{2}))?(?![\d.])/g, (_, amount, cents) => {
      const base = `${amount} ${Number(amount) === 1 ? "dollar" : "dollars"}`;
      const count = Number(cents);
      return count > 0 ? `${base} and ${count} ${count === 1 ? "cent" : "cents"}` : base;
    });
  }
  return clean;
}

function foldIpa(phones, lang) {
  let clean = phones.replace(/\([a-z-]+\)/gi, "").replace(/[͜͡]/gu, "");
  for (const [pair, symbol] of TIES) clean = clean.replaceAll(pair, symbol);
  if (lang === "en") {
    clean = clean.replace(/ɜːɹ|ɜːr|ɜː/gu, "ɜɹ").replaceAll("ɚ", "əɹ")
      .replaceAll("r", "ɹ").replaceAll("ɐ", "ə").replaceAll("ᵻ", "ɪ")
      .replaceAll("ɾ", "T").replaceAll("ʔ", "t").replaceAll("ː", "")
      .replace(/(\S)\u0329/gu, "ᵊ$1");
  }
  return clean.replaceAll("g", "ɡ").replace(/[ɭɫ]/gu, "l")
    .replace(/[\u032a\u0329\u030d\u032f-]/gu, "")
    .replace(/[\u2000-\u200a\u202f]/gu, " ");
}

async function kittenChunks(text, lang, vocab) {
  const lines = normalize(text, lang).split(SENTENCE_BREAK).filter((line) => SPEECH.test(line));
  const eSpeak = lang === "ja" ? null : await phonemizer(lang);
  if (lang === "ja") status("Preparing Japanese pronunciation…");
  const chunks = [];
  let current = "";
  for (const line of lines) {
    const phonemes = eSpeak
      ? eSpeak.textToPhonemesWithTerminator(line).map(({ phonemes, punctuation }) => phonemes + punctuation).join(" ")
      : await japanesePhonemes(line, new URL("ja-dict/", RUNTIME).pathname);
    const clean = Array.from(foldIpa(phonemes, lang))
      .filter((symbol) => Object.hasOwn(vocab, symbol)).join("").trim();
    if (!SPEECH.test(clean)) continue;
    if (current && current.length + clean.length + 1 > MAX_PHONES) {
      chunks.push(current);
      current = "";
    }
    current = `${current} ${clean}`.trim();
    while (current.length > MAX_PHONES) {
      const space = current.lastIndexOf(" ", MAX_PHONES);
      const cut = space > 0 ? space : MAX_PHONES;
      chunks.push(current.slice(0, cut));
      current = current.slice(cut).trimStart();
    }
  }
  if (current) chunks.push(current);
  if (chunks.length === 0) throw new Error("Enter pronounceable text in the selected language.");
  return chunks;
}

async function loadStyle(lang, voice) {
  const key = `${lang}-${voice}`;
  if (!styles.has(key)) {
    const response = await asset(MODELS, `styles/${key}.f32.xz`);
    const packed = await new Response(new XzReadableStream(response.body)).arrayBuffer();
    if (packed.byteLength !== (MAX_PHONES + 3) * STYLE_WIDTH * 4) {
      throw new Error("The voice profile is incomplete.");
    }
    styles.set(key, new Float32Array(packed));
  }
  return styles.get(key);
}

function int64(values, shape) {
  return new ort.Tensor("int64", BigInt64Array.from(values, BigInt), shape);
}

function floats(values, shape) {
  return new ort.Tensor("float32", Float32Array.from(values), shape);
}

function trimKitten(signal, durations, keepStart) {
  const frameCount = durations.reduce((sum, duration) => sum + Number(duration), 0);
  const samplesPerFrame = Math.max(1, Math.round(signal.length / Math.max(frameCount, 1)));
  const start = keepStart ? 0 : Math.max(0, Number(durations[0]) - 1) * samplesPerFrame;
  const end = Math.max(0, Number(durations.at(-1)) - 1) * samplesPerFrame;
  const trimmed = start + end + samplesPerFrame < signal.length
    ? signal.slice(start, signal.length - end) : signal.slice();
  const fade = Math.min(120, Math.floor(trimmed.length / 8));
  for (let n = 0; n < fade; n++) {
    const gain = n / Math.max(fade - 1, 1);
    trimmed[n] *= gain;
    trimmed[trimmed.length - 1 - n] *= gain;
  }
  return trimmed;
}

async function generateKitten(session, { text, lang, voiceA, voiceB, blend, speed }) {
  vocabulary ??= await asset(MODELS, "vocab.json").then((reply) => reply.json());
  const [chunks, primary, secondary] = await Promise.all([
    kittenChunks(text, lang, vocabulary), loadStyle(lang, voiceA),
    voiceB && blend > 0 ? loadStyle(lang, voiceB) : null,
  ]);
  const audio = [];
  for (const [index, chunk] of chunks.entries()) {
    status(`Generating speech · ${index + 1} of ${chunks.length}`);
    const ids = [0, ...Array.from(chunk, (phone) => vocabulary[phone]), 10, 0];
    const offset = (ids.length - 1) * STYLE_WIDTH;
    const style = primary.slice(offset, offset + STYLE_WIDTH);
    if (secondary) {
      for (let index = 0; index < STYLE_WIDTH; index++) {
        style[index] = (1 - blend) * style[index] + blend * secondary[offset + index];
      }
    }
    const result = await session.run({
      input_ids: int64(ids, [1, ids.length]),
      style: new ort.Tensor("float32", style, [1, STYLE_WIDTH]),
      speed: floats([speed], [1]),
    });
    audio.push(trimKitten(result.waveform.data, result.durations.data, index === 0));
  }
  return encodeWav(audio, 24_000, 0.15);
}

async function generateMandarin(session, { text, speed }) {
  mandarinConfig ??= await asset(MODELS, "mandarin.json").then((reply) => reply.json());
  const eSpeak = await phonemizer("zh");
  const config = mandarinConfig;
  const phones = config.phoneme_id_map;
  const segments = normalize(text, "zh").split(SENTENCE_BREAK)
    .flatMap((line) => line.match(/[\s\S]{1,160}/gu) ?? []).filter((line) => SPEECH.test(line));
  const audio = [];
  for (const [index, segment] of segments.entries()) {
    status(`Generating Mandarin speech · ${index + 1} of ${segments.length}`);
    const sounds = eSpeak.textToPhonemesWithTerminator(segment)
      .map(({ phonemes, punctuation }) => phonemes + punctuation).join(" ")
      .replace(/\([a-z-]+\)/gi, "").normalize("NFD");
    const ids = [...phones["^"], ...phones["_"]];
    for (const phone of sounds) {
      if (Object.hasOwn(phones, phone)) ids.push(...phones[phone], ...phones["_"]);
    }
    if (ids.length < 4) continue;
    ids.push(...phones["$"]);
    const feed = {
      input: int64(ids, [1, ids.length]),
      input_lengths: int64([ids.length], [1]),
      scales: floats([config.inference.noise_scale, config.inference.length_scale / speed, config.inference.noise_w], [3]),
    };
    if (session.inputNames.includes("sid")) feed.sid = int64([0], [1]);
    const result = await session.run(feed);
    const signal = result[session.outputNames[0]].data;
    let peak = 0;
    for (const sample of signal) peak = Math.max(peak, Math.abs(sample));
    audio.push(Float32Array.from(signal, (sample) => sample / Math.max(peak, 0.01)));
  }
  return encodeWav(audio, config.audio.sample_rate, 0.12);
}

function encodeWav(chunks, rate, pauseSeconds) {
  if (!chunks.length || !chunks.some((chunk) => chunk.length)) {
    throw new Error("No speech was generated for this text.");
  }
  const pause = Math.round(rate * pauseSeconds);
  const frames = chunks.reduce((sum, chunk) => sum + chunk.length, (chunks.length - 1) * pause);
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);
  view.setUint32(0, 0x52494646);
  view.setUint32(4, buffer.byteLength - 8, true);
  view.setUint32(8, 0x57415645);
  view.setUint32(12, 0x666d7420);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461);
  view.setUint32(40, frames * 2, true);
  let cursor = 44;
  for (const chunk of chunks) {
    for (const value of chunk) {
      if (!Number.isFinite(value)) throw new Error("The engine produced invalid audio.");
      const sample = Math.max(-1, Math.min(1, value));
      view.setInt16(cursor, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
      cursor += 2;
    }
    cursor += pause * 2;
  }
  return buffer;
}

self.onmessage = async ({ data }) => {
  try {
    if (typeof data.text !== "string" || data.text.length > 5_000 || !SPEECH.test(data.text)) {
      throw new Error("Enter 1–5,000 characters of spoken text.");
    }
    const session = await modelFor(data.lang);
    const wav = data.lang === "zh" ? await generateMandarin(session, data) : await generateKitten(session, data);
    self.postMessage({ type: "audio", wav }, [wav]);
  } catch (error) {
    self.postMessage({ type: "error", message: error?.message || String(error) });
  }
};
