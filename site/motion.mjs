const MOUTH_FPS = 25;
const WAITING_MOUTHS = [0, 1, 3, 2, 2, 1, 0, 2, 3, 3, 1, 0, 0];
const SCENE_DURATION = 2_300;

export function analyzeMouth(wav, frames, sampleRate) {
  const framesPerPose = sampleRate / MOUTH_FPS;
  const mouths = new Uint8Array(Math.ceil(frames / framesPerPose));
  for (let i = 0; i < mouths.length; i++) {
    const start = Math.floor(i * framesPerPose);
    const end = Math.min(frames, Math.floor((i + 1) * framesPerPose));
    const stride = Math.max(1, Math.floor((end - start) / 44));
    let energy = 0, detail = 0, count = 0;
    for (let j = start; j < end; j += stride) {
      const sample = wav.getInt16(44 + j * 2, true) / 32768;
      energy += sample * sample;
      if (j + 1 < end) detail += Math.abs(sample - wav.getInt16(46 + j * 2, true) / 32768);
      count++;
    }
    const level = Math.sqrt(energy / Math.max(count, 1));
    mouths[i] = level < .014 ? 0
      : level > .15 ? 3
      : detail / count > level * .16 ? 1 : 2;
  }
  return mouths;
}

// The central trace is brightest. The outer traces have a smaller range.
function drawSignal(ctx, width, height, seconds) {
  const travel = 22 * Math.sin(seconds * .43);
  const phase = 1.2 + seconds * 1.55;
  const level = height * .12;
  ctx.clearRect(0, 0, width, height);
  const gap = Math.max(width > 390 ? 8 : 7, width / 185);
  const count = Math.floor(width / gap);
  const middle = height * .47;
  for (let i = 1; i < count; i++) {
    const x = i * gap;
    const p = x / width;
    const envelope = .25 + .75 * Math.sin(Math.PI * p);
    const wave = Math.sin(p * 20 + phase) + .52 * Math.sin(p * 44 - phase * .75);
    const y = middle + wave * envelope * level + travel * (p - .5);

    ctx.fillStyle = i % 5 === 0 ? "#eeb45d" : "#c88c49";
    ctx.globalAlpha = i % 5 === 0 ? .67 : .40;
    ctx.fillRect(x, Math.round(y / 3) * 3, i % 5 === 0 ? 5 : 3, 3);

    ctx.fillStyle = "#e88c59";
    ctx.globalAlpha = .23;
    const echo = Math.sin(p * 19 - phase * .7) * level * .55;
    ctx.fillRect(x, middle - height * .19 + echo + travel * .24, 2, 2);
    ctx.fillRect(x, middle + height * .19 - echo - travel * .24, 2, 2);
  }
  ctx.globalAlpha = 1;
}

export function createStudioMotion(player, readMouths) {
  const stage = document.getElementById("voice-stage");
  const canvas = document.getElementById("voice-signal");
  const ctx = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const captions = document.querySelectorAll(".capy:has(.mouth)");
  let working = false, visible = true, frame = 0, lastMouth;
  let width = 0, height = 0, progress = 0, shownProgress = -1;
  let backgroundDirty = true, lastPaint = -Infinity;
  let hovering = false, tapUntil = 0, startedAt = null;

  const isPlaying = () => !player.paused && !player.ended;
  const state = () => working ? "working" : isPlaying() ? "playing" : "idle";
  function schedule() {
    if (!frame && !document.hidden) frame = requestAnimationFrame(update);
  }
  function measure() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    if (ctx && width && height) {
      const scale = Math.min(1.75, devicePixelRatio || 1);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
    }
    backgroundDirty = true;
    schedule();
  }
  function update(now) {
    frame = 0;
    if (document.hidden) return;
    const current = state();
    const active = visible && !reduced.matches && (hovering || now < tapUntil);
    if (active) {
      startedAt ??= now;
      progress = (1 - Math.cos((now - startedAt) / SCENE_DURATION * 2 * Math.PI)) / 2;
    } else {
      startedAt = null;
      progress = reduced.matches || !visible || progress < .008 ? 0 : progress * .78;
    }
    if (ctx && width && height && (backgroundDirty || (!reduced.matches && now - lastPaint >= 32))) {
      drawSignal(ctx, width, height, reduced.matches ? 0 : now / 1_000);
      backgroundDirty = false;
      lastPaint = now;
    }
    if (progress !== shownProgress) {
      stage.style.setProperty("--capy-y", `${-progress * 8}px`);
      stage.style.setProperty("--capy-scale", String(1 + progress * .06));
      shownProgress = progress;
    }

    let mouth = null;
    if (active && current === "idle") {
      mouth = WAITING_MOUTHS[Math.floor((now - startedAt) / 105) % WAITING_MOUTHS.length];
    }
    if (current === "working") mouth = WAITING_MOUTHS[Math.floor(now / 105) % WAITING_MOUTHS.length];
    if (current === "playing") mouth = readMouths()?.[Math.floor(player.currentTime * MOUTH_FPS)] ?? 0;
    if (reduced.matches && mouth !== null) mouth = 1;
    if (mouth !== lastMouth) {
      for (const capy of captions) {
        if (mouth === null) capy.removeAttribute("data-speaking");
        else capy.setAttribute("data-speaking", String(mouth));
      }
      lastMouth = mouth;
    }
    if (!reduced.matches && (ctx || current !== "idle" || active || progress > 0)) schedule();
  }

  function sync() {
    document.body.dataset.voiceState = state();
    schedule();
  }
  new ResizeObserver(measure).observe(canvas);
  stage.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "mouse") return;
    hovering = true;
    schedule();
  });
  stage.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "mouse") return;
    hovering = false;
    schedule();
  });
  stage.addEventListener("click", () => {
    if (hovering || reduced.matches) return;
    tapUntil = performance.now() + SCENE_DURATION;
    startedAt = null;
    schedule();
  });
  reduced.addEventListener("change", () => {
    backgroundDirty = true;
    schedule();
  });
  document.addEventListener("visibilitychange", schedule);
  for (const event of ["play", "pause", "ended", "emptied", "seeked"]) player.addEventListener(event, sync);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    schedule();
  }).observe(stage);
  measure();
  sync();

  return {
    setWorking(value) {
      working = value;
      sync();
    },
  };
}
