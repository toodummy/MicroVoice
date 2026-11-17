import { generateAudio } from "./synthesis.mjs?v=3";
import { detectLanguage } from "./detect-language.mjs";
import { MAX_TEXT_LENGTH } from "./text-settings.mjs";
import { analyzeMouth, createStudioMotion } from "./motion.mjs?v=7";

const get = (id) => document.getElementById(id);
const languages = await (async () => {
  try {
    const response = await fetch("./model/voices.json");
    if (!response.ok) throw new Error("Language settings could not be loaded.");
    return await response.json();
  } catch (error) {
    get("status").textContent = "Language settings could not be loaded. Open the studio with run.py.";
    get("status").classList.add("error");
    throw error;
  }
})();
const voices = Object.fromEntries(Object.entries(languages).map(([code, language]) => [code, language.voices]));
const example = Object.fromEntries(Object.entries(languages).map(([code, language]) => [code, language.example]));
const form = get("studio");
const script = get("script");
const lang = get("language");
const autoLanguage = get("auto-language");
const languageStatus = get("language-status");
const voiceA = get("voice-a");
const voiceB = get("voice-b");
const blend = get("blend");
const speed = get("speed");
const generate = get("generate");
const player = get("player");
const canvas = get("waveform");
const download = get("save-wave");
let peaks;
let mouths;
let audioURL;
let inProgress = false;
const motion = createStudioMotion(player, () => mouths);

function setStatus(message, error = false) {
  get("status").textContent = message;
  get("status").classList.toggle("error", error);
}
function profileStatus(message, error = false) {
  get("profile-status").textContent = message;
  get("profile-status").classList.toggle("error", error);
}
function updateControls() {
  blend.disabled = !voiceB.value;
  get("blend-value").textContent = voiceB.value ? `${blend.value}%` : "—";
  get("speed-value").textContent = `${Number(speed.value).toFixed(2)}×`;
  get("count").textContent = `${script.value.length.toLocaleString()} / ${MAX_TEXT_LENGTH.toLocaleString()}`;
  generate.disabled = inProgress || !/[\p{L}\p{N}]/u.test(script.value);
}
function loadVoices() {
  const options = Object.entries(voices[lang.value]);
  voiceA.replaceChildren(...options.map(([key, name]) => new Option(name, key)));
  const blends = options.length > 1 ? options : [];
  voiceB.replaceChildren(new Option("None", ""), ...blends.map(([key, name]) => new Option(name, key)));
  voiceB.disabled = blends.length === 0;
  updateControls();
}
function currentVoice() {
  return { lang: lang.value, voiceA: voiceA.value, voiceB: voiceB.value,
    blend: Number(blend.value) / 100, speed: Number(speed.value) };
}
function drawWave() {
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height || !ctx) return;
  const scale = Math.min(2, window.devicePixelRatio || 1);
  const { width, height } = rect;
  const rasterWidth = Math.round(width * scale);
  const rasterHeight = Math.round(height * scale);
  if (canvas.width !== rasterWidth) canvas.width = rasterWidth;
  if (canvas.height !== rasterHeight) canvas.height = rasterHeight;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const mid = height / 2;
  const count = peaks?.length || 76;
  const gap = (width - 22) / count;
  const progress = player.duration > 0 ? player.currentTime / player.duration : 0;
  const played = Math.min(count, Math.floor(progress * count));
  for (let i = 0; i < count; i++) {
    const height = peaks ? Math.max(3, Math.sqrt(peaks[i]) * 69) : 5;
    ctx.fillStyle = peaks ? (i < played ? "#fff0cc" : "#f8c775") : "#565967";
    ctx.fillRect(11 + i * gap, mid - height / 2, Math.max(1.1, gap * 0.53), height);
  }
  if (peaks && progress > 0 && progress < 1) {
    const head = 11 + progress * (width - 22);
    ctx.fillStyle = "#ffab9a";
    ctx.fillRect(head, 6, 1.5, height - 12);
    ctx.fillRect(head - 1.5, 6, 4.5, 3);
  }
}
function parseWave(wav) {
  const data = new DataView(wav);
  if (wav.byteLength < 46 || data.getUint32(0) !== 0x52494646
    || data.getUint32(8) !== 0x57415645 || data.getUint32(36) !== 0x64617461) {
    throw new Error("The engine returned an invalid WAV file.");
  }
  const frames = data.getUint32(40, true) / 2;
  if (44 + frames * 2 !== wav.byteLength) throw new Error("The WAV response is incomplete.");
  const peaks = new Float32Array(76);
  const stride = Math.max(1, Math.ceil(frames / 200_000));
  for (let i = 0; i < frames; i += stride) {
    const bucket = Math.floor(i * peaks.length / frames);
    const level = Math.abs(data.getInt16(44 + i * 2, true)) / 32768;
    peaks[bucket] = Math.max(peaks[bucket], level);
  }
  const sampleRate = data.getUint32(24, true);
  if (!sampleRate) throw new Error("The WAV sample rate is invalid.");
  return { peaks, mouths: analyzeMouth(data, frames, sampleRate), sampleRate, seconds: frames / sampleRate };
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (generate.disabled) return;
  inProgress = true;
  motion.setWorking(true);
  updateControls();
  setStatus("Generating speech on your CPU…");
  const start = performance.now();
  try {
    const wav = await generateAudio({ text: script.value, ...currentVoice() }, setStatus);
    const audio = parseWave(wav);
    if (audioURL) URL.revokeObjectURL(audioURL);
    audioURL = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
    player.src = audioURL;
    download.href = audioURL;
    player.hidden = false;
    download.hidden = false;
    const elapsed = (performance.now() - start) / 1000;
    get("audio-info").textContent = `${audio.seconds.toFixed(1)} s of audio · ${elapsed.toFixed(1)} s to generate`;
    get("audio-format").textContent = `${audio.sampleRate / 1000} kHz · Mono`;
    peaks = audio.peaks;
    mouths = audio.mouths;
    drawWave();
    setStatus("Audio ready.");
  } catch (error) {
    setStatus(error.message || "Could not generate audio.", true);
  } finally {
    inProgress = false;
    motion.setWorking(false);
    updateControls();
  }
});
function pickLanguage(text) {
  if (!autoLanguage.checked || !/\p{L}/u.test(text)) return;
  const code = detectLanguage(text);
  if (!code || !Object.hasOwn(voices, code)) {
    languageStatus.textContent = "Language unclear. You can choose it above.";
    return;
  }
  if (lang.value !== code) {
    lang.value = code;
    loadVoices();
  }
  languageStatus.textContent = `Detected ${languages[code].name}`;
}

script.addEventListener("paste", (event) => {
  const pasted = event.clipboardData?.getData("text/plain");
  if (pasted) pickLanguage(pasted);
});
autoLanguage.addEventListener("change", () => {
  languageStatus.textContent = "";
  pickLanguage(script.value);
});
lang.addEventListener("change", () => {
  autoLanguage.checked = false;
  languageStatus.textContent = "";
  if (Object.values(example).includes(script.value)) script.value = example[lang.value];
  loadVoices();
});
get("example").addEventListener("click", () => {
  script.value = example[lang.value];
  updateControls();
  script.focus();
});
for (const control of [script, blend, speed]) control.addEventListener("input", updateControls);
voiceB.addEventListener("change", updateControls);
get("save-profile").addEventListener("click", () => {
  const profile = { format: "local-voice-profile", version: 1, ...currentVoice() };
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(profile, null, 2) + "\n"], { type: "application/json" }));
  link.download = `capyvoice-${profile.lang}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
  profileStatus("Profile exported.");
});
get("profile-file").addEventListener("change", async ({ currentTarget }) => {
  const file = currentTarget.files[0];
  currentTarget.value = "";
  if (!file) return;
  try {
    if (file.size > 8_192) throw new Error("Profile file is too large.");
    const profile = JSON.parse(await file.text());
    const { lang: language, voiceA: a, voiceB: b, version, format } = profile;
    if (format !== "local-voice-profile" || version !== 1 || !Object.hasOwn(voices, language)
      || !Object.hasOwn(voices[language], a)
      || (b !== "" && (Object.keys(voices[language]).length < 2 || !Object.hasOwn(voices[language], b)))
      || !Number.isFinite(profile.blend) || profile.blend < 0 || profile.blend > 1
      || !Number.isFinite(profile.speed) || profile.speed < 0.75 || profile.speed > 1.3) {
      throw new Error("Invalid voice settings.");
    }
    if (Object.values(example).includes(script.value)) script.value = example[language];
    lang.value = language;
    autoLanguage.checked = false;
    languageStatus.textContent = "";
    loadVoices();
    voiceA.value = a;
    voiceB.value = b;
    blend.value = Math.round(profile.blend * 100);
    speed.value = profile.speed;
    updateControls();
    profileStatus("Profile imported.");
  } catch (error) {
    profileStatus(`Could not import profile. ${error.message}`, true);
  }
});
lang.replaceChildren(...Object.entries(languages).map(([code, language]) => new Option(language.name, code)));
loadVoices();
for (const event of ["loadedmetadata", "timeupdate", "seeked", "ended"]) {
  player.addEventListener(event, drawWave);
}
new ResizeObserver(drawWave).observe(canvas);
