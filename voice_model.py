"""Local CPU inference for the bundled Kitten TTS 2 Mini ONNX checkpoint."""

from functools import lru_cache
from pathlib import Path
from threading import Lock
import io
import json
import lzma
import os
import re
import shutil
import tempfile
import unicodedata
import wave

import espeakng_loader
import numpy as np
import onnxruntime as ort
from phonemizer.backend import EspeakBackend
from phonemizer.backend.espeak.wrapper import EspeakWrapper
from phonemizer.separator import Separator

ROOT = Path(__file__).resolve().parent / "site" / "model"
SAMPLE_RATE = 24_000
MAX_TEXT = 5_000
MAX_PHONES = 350
LANGUAGES = json.loads((ROOT / "voices.json").read_text(encoding="utf-8"))
STYLES = {lang: tuple(spec["voices"]) for lang, spec in LANGUAGES.items()}
ESPEAK_LANGUAGES = {
    "en": "en-us", "ru": "ru", "es": "es", "fr": "fr-fr", "de": "de",
    "ko": "ko", "it": "it", "pt": "pt-br",
}

TIES = {
    "a͡ɪ": "I", "a͡ʊ": "W", "d͡z": "ʣ", "d͡ʒ": "ʤ", "e͡ɪ": "A",
    "o͡ʊ": "O", "ə͡ʊ": "Q", "s͡s": "S", "t͡s": "ʦ", "t͡ʃ": "ʧ", "ɔ͡ɪ": "Y",
}
COMMON_FOLD = str.maketrans({
    "g": "ɡ", "ɭ": "l", "ɫ": "l", " ": " ", "\u202f": " ", "͡": "",
    "\u032a": "", "\u0329": "", "\u030d": "", "\u032f": "", "-": "",
})
EN_FOLD = str.maketrans({
    "r": "ɹ", "ɚ": "əɹ", "ɐ": "ə", "ᵻ": "ɪ", "ɾ": "T", "ʔ": "t", "ː": "",
})
SENTENCE_BREAK = re.compile(r"(?<=[.!?…])\s+|(?<=[。！？])|\n+")
LOCK = Lock()


def _normalize(text: str, lang: str) -> str:
    text = unicodedata.normalize("NFC", text.strip()).replace("\r\n", "\n")
    text = re.sub(r"\.{3,}", "…", text)
    if lang == "en":
        text = re.sub(r"\b(Mr|Mrs|Ms|Dr|Prof|St)\.(?=\s+[^\W\d_])", r"\1",
                      text, flags=re.IGNORECASE)

        def say_dollars(match):
            amount, cents = match.groups()
            dollars = "dollar" if int(amount) == 1 else "dollars"
            phrase = f"{amount} {dollars}"
            if cents and int(cents):
                suffix = "cent" if int(cents) == 1 else "cents"
                phrase += f" and {int(cents)} {suffix}"
            return phrase

        text = re.sub(r"\$(\d{1,10})(?:\.(\d{2}))?(?![\d.])", say_dollars, text)
    return text


def _load_session(filename: str) -> ort.InferenceSession:
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    options.log_severity_level = 3
    # Stream the original ONNX bytes to a temporary file to limit RAM use.
    with tempfile.TemporaryDirectory(prefix="local-voice-") as scratch:
        model = Path(scratch) / "model.onnx"
        with lzma.open(ROOT / filename, "rb") as packed, model.open("wb") as plain:
            shutil.copyfileobj(packed, plain, length=1024 * 1024)
        return ort.InferenceSession(model, options, providers=["CPUExecutionProvider"])


def _wav(blocks: list[bytes], rate: int) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        wav.writeframes(b"".join(blocks))
    return buffer.getvalue()


class VoiceModel:
    def __init__(self) -> None:
        os.environ.setdefault("ESPEAK_DATA_PATH", espeakng_loader.get_data_path())
        EspeakWrapper.set_library(espeakng_loader.get_library_path())
        self.session = _load_session("kitten.onnx.xz")
        self.vocab = json.loads((ROOT / "vocab.json").read_text(encoding="utf-8"))
        self.phonemizers = {}
        self.japanese = None
        self.styles = {}

    def _phonemize_lines(self, lines: list[str], lang: str) -> list[str]:
        if lang == "ja":
            if self.japanese is None:
                # Cutlet is the Japanese front end used by Kitten TTS 2 Mini.
                from misaki.cutlet import Cutlet
                self.japanese = Cutlet()
            return [self.japanese(line)[0] for line in lines]
        if lang not in self.phonemizers:
            self.phonemizers[lang] = EspeakBackend(
                language=ESPEAK_LANGUAGES[lang], preserve_punctuation=True, with_stress=True,
                tie=True, language_switch="remove-flags",
            )
        separator = Separator(phone="", word=" ", syllable="")
        return self.phonemizers[lang].phonemize(lines, separator=separator, strip=True)

    def _phonemes(self, text: str, lang: str) -> list[str]:
        lines = [part.strip() for part in SENTENCE_BREAK.split(_normalize(text, lang)) if part.strip()]
        phones = self._phonemize_lines(lines, lang)
        chunks = []
        current = ""
        for line in phones:
            for pair, symbol in TIES.items():
                line = line.replace(pair, symbol)
            if lang == "en":
                line = line.replace("ɜːɹ", "ɜɹ").replace("ɜː", "ɜɹ")
                line = re.sub(r"(\S)\u0329", r"ᵊ\1", line).translate(EN_FOLD)
            clean = "".join(c for c in line.translate(COMMON_FOLD) if c in self.vocab).strip()
            if not clean or not any(c.isalpha() for c in clean):
                continue
            if current and len(current) + len(clean) + 1 > MAX_PHONES:
                chunks.append(current)
                current = ""
            current = f"{current} {clean}".strip()
            while len(current) > MAX_PHONES:
                space = current.rfind(" ", 0, MAX_PHONES + 1)
                cut = space if space > 0 else MAX_PHONES
                chunks.append(current[:cut])
                current = current[cut:].lstrip()
        if current:
            chunks.append(current)
        return chunks

    def _style(self, lang: str, voice: str) -> np.ndarray:
        key = (lang, voice)
        if key not in self.styles:
            path = ROOT / "styles" / f"{lang}-{voice}.f32.xz"
            with lzma.open(path, "rb") as packed:
                data = packed.read()
            self.styles[key] = np.frombuffer(data, dtype="<f4").reshape(MAX_PHONES + 3, 256)
        return self.styles[key]

    def synthesize(self, text, lang="en", voice_a="studio", voice_b="", blend=0, speed=1) -> bytes:
        chunks = self._phonemes(text, lang)
        if not chunks:
            raise ValueError("Enter pronounceable text in the selected language.")
        primary = self._style(lang, voice_a)
        secondary = self._style(lang, voice_b) if voice_b and blend > 0 else None
        blocks = []
        for index, chunk in enumerate(chunks):
            ids = [0, *(self.vocab[phone] for phone in chunk), 10, 0]
            row = len(ids) - 1
            style = primary[row:row + 1]
            if secondary is not None:
                style = (1 - blend) * style + blend * secondary[row:row + 1]
            signal, durations = self.session.run(None, {
                "input_ids": np.array([ids], dtype=np.int64),
                "style": style,
                "speed": np.array([speed], dtype=np.float32),
            })
            if not signal.size or not np.isfinite(signal).all():
                raise RuntimeError("The model returned invalid audio.")
            frame = max(1, round(len(signal) / max(int(durations.sum()), 1)))
            start = max(0, int(durations[0]) - 1) * frame if index else 0
            end = max(0, int(durations[-1]) - 1) * frame
            if start + end + frame < len(signal):
                signal = signal[start:len(signal) - end]
            signal = np.clip(signal, -1, 1)
            fade = min(120, signal.size // 8)
            if fade:
                ramp = np.linspace(0, 1, fade, dtype=np.float32)
                signal[:fade] *= ramp
                signal[-fade:] *= ramp[::-1]
            if index:
                blocks.append(bytes(int(SAMPLE_RATE * 0.15) * 2))
            pcm = np.rint(signal * np.where(signal < 0, 32768, 32767)).astype("<i2")
            blocks.append(pcm.tobytes())
        return _wav(blocks, SAMPLE_RATE)


@lru_cache(maxsize=1)
def _model() -> VoiceModel:
    return VoiceModel()


@lru_cache(maxsize=1)
def _mandarin_model():
    from piper.config import PiperConfig
    from piper.voice import PiperVoice

    config = PiperConfig.from_dict(json.loads((ROOT / "mandarin.json").read_text(encoding="utf-8")))
    return PiperVoice(_load_session("mandarin.onnx.xz"), config)


def _synthesize_mandarin(text: str, speed: float) -> bytes:
    from piper.config import SynthesisConfig

    model = _mandarin_model()
    rate = model.config.sample_rate
    settings = SynthesisConfig(length_scale=model.config.length_scale / speed)
    blocks = []
    lines = SENTENCE_BREAK.split(_normalize(text, "zh"))
    for line in lines:
        for start in range(0, len(line), 160):
            for chunk in model.synthesize(line[start:start + 160], syn_config=settings):
                if chunk.audio_float_array.size and np.isfinite(chunk.audio_float_array).all():
                    if blocks:
                        blocks.append(bytes(int(rate * 0.12) * 2))
                    blocks.append(chunk.audio_int16_array.astype("<i2", copy=False).tobytes())
    if not blocks:
        raise ValueError("Enter pronounceable text in Mandarin.")
    return _wav(blocks, rate)


def generate(payload: dict) -> bytes:
    if not isinstance(payload, dict):
        raise ValueError("Invalid generation request.")
    text = payload.get("text")
    if not isinstance(text, str) or len(text) > MAX_TEXT or not any(c.isalnum() for c in text):
        raise ValueError("Enter 1–5,000 characters of spoken text.")
    lang = payload.get("lang", "en")
    voice_a = payload.get("voiceA")
    voice_b = payload.get("voiceB", "")
    if not isinstance(lang, str) or lang not in STYLES:
        raise ValueError("Choose a supported language.")
    if voice_a is None:
        voice_a = STYLES[lang][0]
    secondary = STYLES[lang] if lang != "zh" else ()
    if voice_a not in STYLES[lang] or voice_b not in ("", *secondary):
        raise ValueError("Invalid voice preset.")
    blend = payload.get("blend", 0)
    speed = payload.get("speed", 1)
    if type(blend) not in (float, int) or type(speed) not in (float, int):
        raise ValueError("Invalid voice settings.")
    if not 0 <= blend <= 1 or not 0.75 <= speed <= 1.3:
        raise ValueError("Invalid voice settings.")
    with LOCK:
        if lang == "zh":
            return _synthesize_mandarin(text, speed)
        return _model().synthesize(text, lang, voice_a, voice_b, blend, speed)
