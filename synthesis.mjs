let worker;
let forceSingle = false;

function enableMulticore() {
  if (globalThis.crossOriginIsolated || !globalThis.isSecureContext
    || !navigator.serviceWorker || navigator.hardwareConcurrency < 2 || window.top !== window) return;

  const serviceWorker = navigator.serviceWorker;
  const reloadKey = "microvoice-multicore-reload";
  let interacted = false;
  const markInteraction = () => { interacted = true; };
  window.addEventListener("input", markInteraction, { capture: true, once: true });
  window.addEventListener("pointerdown", markInteraction, { capture: true, once: true });
  window.addEventListener("keydown", markInteraction, { capture: true, once: true });
  serviceWorker.addEventListener("controllerchange", () => {
    try {
      // Reload the untouched page once to apply the isolation headers.
      if (interacted || !serviceWorker.controller || sessionStorage.getItem(reloadKey)) return;
      sessionStorage.setItem(reloadKey, "1");
      window.location.reload();
    } catch {
      // The audio engine can still run on one thread.
    }
  }, { once: true });
  serviceWorker.register(new URL("./isolation.js", import.meta.url)).catch(() => {});
}

enableMulticore();

export function generateAudio(settings, updateStatus) {
  if (!globalThis.WebAssembly || !globalThis.Worker || !globalThis.DecompressionStream) {
    throw new Error("Open MicroVoice in a current version of Safari, Chrome, Edge, or Firefox.");
  }
  const allowMulticore = globalThis.crossOriginIsolated && navigator.hardwareConcurrency > 1;
  return new Promise((resolve, reject) => {
    function start() {
      worker ??= new Worker(new URL("./synth-worker.mjs?v=2", import.meta.url), { type: "module" });
      const activeWorker = worker;
      function retry() {
        activeWorker.terminate();
        worker = undefined;
        if (allowMulticore && !forceSingle) {
          forceSingle = true;
          updateStatus("Starting the single-thread audio engine…");
          start();
          return;
        }
        reject(new Error("The browser could not start the audio engine. Try reloading the page."));
      }
      activeWorker.onmessage = ({ data }) => {
        if (data.type === "status") {
          updateStatus(data.message);
        } else if (data.type === "audio") {
          resolve(data.wav);
        } else if (data.type === "error") {
          reject(new Error(data.message));
        } else if (data.type === "retry-single") {
          retry();
        }
      };
      activeWorker.onerror = retry;
      activeWorker.postMessage({ ...settings, singleThread: !allowMulticore || forceSingle });
    }
    start();
  });
}
