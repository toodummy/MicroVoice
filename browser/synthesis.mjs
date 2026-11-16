let worker;

export function generateAudio(settings, updateStatus) {
  if (!globalThis.WebAssembly || !globalThis.Worker || !globalThis.DecompressionStream) {
    throw new Error("Open MicroVoice in a current version of Safari, Chrome, Edge, or Firefox.");
  }

  worker ??= new Worker(new URL("./synth-worker.mjs", import.meta.url), { type: "module" });
  const activeWorker = worker;
  return new Promise((resolve, reject) => {
    activeWorker.onmessage = ({ data }) => {
      if (data.type === "status") {
        updateStatus(data.message);
      } else if (data.type === "audio") {
        resolve(data.wav);
      } else if (data.type === "error") {
        reject(new Error(data.message));
      }
    };
    activeWorker.onerror = () => {
      activeWorker.terminate();
      worker = undefined;
      reject(new Error("The browser could not start the audio engine. Try reloading the page."));
    };
    activeWorker.postMessage(settings);
  });
}
