import { createReadStream, createWriteStream } from "node:fs";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import xzDecompress from "xz-decompress";

const { XzReadableStream } = xzDecompress;

const root = new URL("./", import.meta.url);
const dependencies = new URL("node_modules/", root);
const dist = new URL("dist/", root);
const vendor = new URL("vendor/", dist);
const notices = new URL("licenses/", dist);

await rm(dist, { force: true, recursive: true });
await cp(new URL("../site/", root), dist, { recursive: true });
await mkdir(vendor);
await cp(new URL("../licenses/", root), notices, { recursive: true });

const copies = [
  [new URL("synthesis.mjs", root), new URL("synthesis.mjs", dist)],
  [new URL("isolation.js", root), new URL("isolation.js", dist)],
  [new URL("onnxruntime-web/dist/ort.wasm.min.mjs", dependencies), new URL("ort.wasm.min.mjs", vendor)],
  [new URL("onnxruntime-web/dist/ort-wasm-simd-threaded.mjs", dependencies), new URL("ort-wasm-simd-threaded.mjs", vendor)],
  [new URL("kuromoji/dict/", dependencies), new URL("ja-dict/", vendor)],
  [new URL("kuromoji/LICENSE-2.0.txt", dependencies), new URL("Kuromoji-LICENSE.txt", notices)],
  [new URL("kuromoji/NOTICE.md", dependencies), new URL("Kuromoji-NOTICE.md", notices)],
  [new URL("@echogarden/espeak-ng-emscripten/COPYING", dependencies), new URL("eSpeak-NG-COPYING.txt", notices)],
  [new URL("@pipedog/espeak-ng/LICENSE", dependencies), new URL("Pipedog-LICENSE.txt", notices)],
  [new URL("third-party/", root), notices],
];
await Promise.all(copies.map(([source, target]) => cp(source, target, { recursive: true })));

await Promise.all([
  ["onnxruntime-web/dist/ort-wasm-simd-threaded.wasm", "ort.wasm.gz"],
  ["@echogarden/espeak-ng-emscripten/espeak-ng.data", "espeak-ng.data.gz"],
].map(([source, target]) => pipeline(
  createReadStream(new URL(source, dependencies)),
  createGzip({ level: 6 }),
  createWriteStream(new URL(target, vendor)),
)));

// Gzip uses the browser's native decompressor while retaining the original weights.
const modelDirectory = new URL("model/", dist);
const infoUrl = new URL("model-info.json", modelDirectory);
const info = JSON.parse(await readFile(infoUrl, "utf8"));
for (const model of [info, info.mandarin]) {
  const from = new URL(model.onnx_pack, modelDirectory);
  const compressed = model.onnx_pack.replace(/\.xz$/, ".gz");
  const to = new URL(compressed, modelDirectory);
  const original = new XzReadableStream(Readable.toWeb(createReadStream(from)));
  await pipeline(Readable.fromWeb(original), createGzip({ level: 6 }), createWriteStream(to));
  await rm(from);
  model.onnx_pack = compressed;
  model.packed_onnx_bytes = (await stat(to)).size;
}
await writeFile(infoUrl, JSON.stringify(info, null, 2) + "\n");

await build({
  entryPoints: [fileURLToPath(new URL("synth-worker.mjs", root))],
  outfile: fileURLToPath(new URL("synth-worker.mjs", dist)),
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: true,
  legalComments: "eof",
  external: ["./vendor/ort.wasm.min.mjs", "node:*", "module", "fs", "url", "path"],
});

const htmlPath = new URL("index.html", dist);
const html = (await readFile(htmlPath, "utf8"))
  .replace("script-src 'self';", "script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:;")
  .replace("On-device synthesis", "Browser mode")
  .replace("Generate narration on your laptop. Blend two voices to create a voice profile you can reuse.",
    "Generate speech in ten languages. Your text and audio stay on this device.")
  .replace("Ready · The first generation loads the local model.",
    "Ready · First use downloads the model and pronunciation data.")
  .replace("CPU inference</footer>", "On-device synthesis <span aria-hidden=\"true\">·</span> <a class=\"quiet\" href=\"https://github.com/toodummy/MicroVoice\">Source on GitHub</a></footer>");
await writeFile(htmlPath, html);
await writeFile(new URL(".nojekyll", dist), "");
console.log("Browser build ready in browser/dist.");
