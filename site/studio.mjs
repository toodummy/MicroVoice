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
const voiceA = get("voice-a");
const voiceB = get("voice-b");
const blend = get("blend");
const speed = get("speed");
const generate = get("generate");
const player = get("player");
const canvas = get("waveform");
const download = get("save-wave");
let peaks;
let audioURL;
let inProgress = false;

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
  get("count").textContent = `${script.value.length.toLocaleString()} / 5,000`;
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
  const scale = window.devicePixelRatio || 1;
  const { width, height } = rect;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  ctx.scale(scale, scale);
  const mid = height / 2;
  const count = peaks?.length || 76;
  const gap = (width - 22) / count;
  for (let i = 0; i < count; i++) {
    const height = peaks ? Math.max(3, Math.sqrt(peaks[i]) * 69) : 5;
    ctx.fillStyle = peaks ? "#f8c775" : "#565967";
    ctx.fillRect(11 + i * gap, mid - height / 2, Math.max(1.1, gap * 0.53), height);
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
  for (let i = 0; i < frames; i++) {
    const bucket = Math.floor(i * peaks.length / frames);
    const level = Math.abs(data.getInt16(44 + i * 2, true)) / 32768;
    peaks[bucket] = Math.max(peaks[bucket], level);
  }
  const sampleRate = data.getUint32(24, true);
  return { peaks, sampleRate, seconds: frames / sampleRate };
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (generate.disabled) return;
  inProgress = true;
  updateControls();
  setStatus("Generating speech on your CPU…");
  const start = performance.now();
  try {
    const response = await fetch("/api/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: script.value, ...currentVoice() }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(result?.message || "Synthesis failed.");
    }
    const wav = await response.arrayBuffer();
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
    drawWave();
    setStatus("Audio ready.");
  } catch (error) {
    setStatus(error.message || "Could not generate audio.", true);
  } finally {
    inProgress = false;
    updateControls();
  }
});
lang.addEventListener("change", () => {
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
  link.download = `local-voice-${profile.lang}.json`;
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
new ResizeObserver(drawWave).observe(canvas);
