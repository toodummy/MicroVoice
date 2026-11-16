# CapyVoice

**[Launch CapyVoice in your browser](https://toodummy.github.io/MicroVoice/)**

Generate speech on your laptop in English, Russian, Spanish, French, German,
Mandarin, Japanese, Korean, Italian, and Brazilian Portuguese. The interface
opens in your browser and the model runs on your CPU.

## Browser mode

Use the live link above in a current version of Chrome, Edge, Firefox, or
Safari. Paste up to 30,000 characters and select **Generate audio**. CapyVoice detects the language on paste, and you can choose a language manually at any time.

The first synthesis downloads the selected model and pronunciation data.
Browser mode uses up to four CPU threads when the browser supports them.
Generation and WAV export run on your device. Your text and recordings stay in your browser.

<details>
<summary>Build and preview locally (developers)</summary>

Use Node.js 20 or later.

```sh
cd browser
npm ci
npm run build
python3 -m http.server 8765 --directory dist
```

After starting the server, open `http://127.0.0.1:8765/` on the computer
running it. Japanese browser pronunciation uses the Kuromoji dictionary.
Browser runtime and dictionary notices are in `dist/licenses` after the build.

</details>

## Desktop mode

Install 64-bit Python 3.11 or 3.12. Clone the repository or extract its ZIP,
then open the project folder.

**Windows**

Double-click `Start-Windows.cmd`, or run the following in PowerShell.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe run.py
```

Use `-3.11` if you installed Python 3.11.

**macOS 13+ or Linux**

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python run.py
```

The desktop launcher opens the studio locally at `http://127.0.0.1:8765/`. Choose a language and voice,
enter a script or load the sample text, then select **Generate audio**.
You can play the result or download a mono WAV. Keep the launcher terminal
open while using it.

Initial setup downloads Python packages, including the Japanese pronunciation
dictionary. Synthesis works offline after setup. The model and voice assets
occupy 97.4 MB on disk. Python, runtime packages and dictionaries use
additional disk space. The first generation with either model expands the
checkpoint to a temporary file for ONNX Runtime and takes longer than later runs.

## Voice profiles

The Kitten voices can be blended within their language. Select a second voice,
then adjust the blend and speaking speed. **Export profile** saves these settings
as JSON. Existing English and Russian profile files are compatible.

The Mandarin model has one HuaYan voice. You can adjust its speaking speed.
Kitten voices export 24 kHz WAV. Mandarin exports its native 16 kHz WAV.
HuaYan’s vocabulary omits some tone markers emitted by its phonemizer, so
Mandarin tone accuracy can vary.
The profiles are derived from the pretrained voices.

## Command line

```sh
python run.py say --text "The last train had already left." -o narration.wav
python run.py say --lang pt --voice rafael --text-file script.txt -o narration.wav
python run.py say --lang zh --text-file script-zh.txt -o mandarin.wav
```

Save text files as UTF-8. Use `python run.py serve --port 8766` if another
app is using the default port.

## Models and lossless compression

KittenML's [Kitten TTS 2 Mini](https://huggingface.co/KittenML/kitten-tts-2-mini/tree/c01797caec3967b400da457656e011eb81f530a4)
uses the original 82M-parameter INT8 ONNX graph for nine languages. Mandarin uses
[Piper HuaYan x_low](https://huggingface.co/rhasspy/piper-voices/tree/v1.0.0/zh/zh_CN/huayan/x_low)
with its original ONNX graph. Both graphs and voice profiles are stored with
lossless XZ compression. The checkpoints were verified against their source files
after decompression. See `site/model/model-info.json` for sizes and SHA-256
hashes and the `licenses` folder for attribution and the Mandarin model card.

The companion audio demo plays the default voice for each language in this
order: English, Russian, Spanish, French, German, Mandarin, Japanese, Korean,
Italian, Brazilian Portuguese. Each sample's text is available in the app
and in `site/model/voices.json`.
