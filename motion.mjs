const MOUTH_FPS = 25;
const WAITING_MOUTHS = [0, 1, 3, 2, 2, 1, 0, 2, 3, 3, 1, 0, 0];
const clamp = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => x * x * (3 - 2 * x);

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

function drawSoundField(ctx, width, height, travel) {
  const focus = ease(travel);
  const yaw = -.38 + .99 * focus;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const unit = Math.min(width, height * 1.65) * (.068 + .025 * focus);

  function project(x, y, z) {
    const depth = z * cos - x * sin;
    const scale = unit / (1 + depth * .052);
    return [width * .5 + (x * cos + z * sin) * scale, height * (.70 + .06 * focus) + (-depth * (.25 + .14 * focus) - y) * scale];
  }
  function face(points, fill, edge) {
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (const point of points.slice(1)) ctx.lineTo(...point);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (edge) {
      ctx.strokeStyle = edge;
      ctx.stroke();
    }
  }

  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#b66c5435";
  ctx.beginPath();
  for (let i = -8; i <= 8; i++) {
    ctx.moveTo(...project(i, 0, -6));
    ctx.lineTo(...project(i, 0, 7));
    if (Math.abs(i) > 6) continue;
    ctx.moveTo(...project(-8, 0, i));
    ctx.lineTo(...project(8, 0, i));
  }
  ctx.stroke();

  const columns = [];
  for (let z = -5; z <= 6; z++) {
    for (let x = -7; x <= 7; x++) {
      const distance = Math.hypot(x, z);
      if ((Math.abs(x * 17 + z * 23) % 9 < 3) || distance < 2.4) continue;
      const sweep = Math.max(0, 1 - Math.abs(z - (-6 + 13 * focus)) / 2.2);
      const ring = Math.exp(-((distance - 4.2) ** 2) / 2.4);
      const weight = (.5 + .5 * Math.sin(x * 3.17 + z * 6.31));
      const rise = .09 + weight * .51 + sweep * .98 + ring * focus * .8;
      columns.push({ x, z, rise, depth: z * cos - x * sin, light: sweep });
    }
  }
  columns.sort((a, b) => b.depth - a.depth);
  for (const { x, z, rise, light } of columns) {
    const a = project(x - .32, rise, z - .32), b = project(x + .32, rise, z - .32);
    const c = project(x + .32, rise, z + .32), d = project(x - .32, rise, z + .32);
    const lowA = project(x - .32, 0, z - .32), lowB = project(x + .32, 0, z - .32);
    const lowC = project(x + .32, 0, z + .32), lowD = project(x - .32, 0, z + .32);
    face([a, b, lowB, lowA], light > .58 ? "#9c3428" : "#301f28");
    if (yaw > 0) face([b, c, lowC, lowB], "#41272e");
    else face([d, a, lowA, lowD], "#58302d");
    face([a, b, c, d], light > .74 ? "#ff9d5c" : light > .35 ? "#a65541" : "#533340",
      light > .6 ? "#fabc7ba6" : "#a96f6c45");
  }

  // Pale, interrupted paths lead the light across the floor as the camera moves.
  for (const lane of [-4.5, 0, 4.5]) {
    for (let offset = -6; offset < 6; offset += .5) {
      const sweep = Math.max(0, 1 - Math.abs(offset + 6 - focus * 12) / 3.6);
      if (!sweep) continue;
      ctx.strokeStyle = `rgba(255, 174, 111, ${sweep * .6})`;
      ctx.beginPath();
      ctx.moveTo(...project(lane, .03, offset));
      ctx.lineTo(...project(lane, .03, offset + .32));
      ctx.stroke();
    }
  }
}

export function createStudioMotion(player, readMouths) {
  const story = document.getElementById("hero-story");
  const stage = document.getElementById("voice-stage");
  const canvas = document.getElementById("voice-signal");
  const ctx = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const captions = document.querySelectorAll(".capy:has(.mouth)");
  let working = false, visible = true, frame = 0, lastMouth;
  let width = 0, height = 0, progress = 0, target = 0, painted = -1;

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
    painted = -1;
    readScroll();
  }
  function readScroll() {
    const hero = story.firstElementChild;
    const stickyTop = Number.parseFloat(getComputedStyle(hero).top) || 0;
    target = reduced.matches ? 0 : clamp((stickyTop - story.getBoundingClientRect().top)
      / Math.max(1, story.clientHeight - hero.clientHeight));
    schedule();
  }
  function update(now) {
    frame = 0;
    if (document.hidden) return;
    const current = state();
    progress += (target - progress) * .20;
    if (Math.abs(progress - target) < .002 || reduced.matches) progress = target;
    if (visible && progress !== painted) {
      if (ctx && width && height) drawSoundField(ctx, width, height, progress);
      stage.style.setProperty("--capy-x", `${(progress * .09 - .04) * width}px`);
      stage.style.setProperty("--capy-y", `${-progress * 36}px`);
      stage.style.setProperty("--capy-scale", String(1 + progress * .16));
      painted = progress;
    }

    let mouth = null;
    if (visible && current === "idle" && progress > .30 && progress < .78) {
      mouth = WAITING_MOUTHS[Math.floor((progress - .30) / .48 * WAITING_MOUTHS.length)];
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
    if (!reduced.matches && (current !== "idle" || (visible && progress !== target))) schedule();
  }

  function sync() {
    document.body.dataset.voiceState = state();
    schedule();
  }
  new ResizeObserver(measure).observe(stage);
  window.addEventListener("scroll", readScroll, { passive: true });
  reduced.addEventListener("change", readScroll);
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
