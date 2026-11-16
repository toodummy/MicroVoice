const TAU = Math.PI * 2;
const DEMO_MS = 1_650;
const clamp01 = (value) => Math.max(0, Math.min(1, value));

export function createStudioMotion(player, readPeaks) {
  const stage = document.getElementById("voice-stage");
  const canvas = document.getElementById("voice-signal");
  const capy = document.getElementById("capy-button");
  const ctx = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let working = false;
  let visible = true;
  let pending = 0;
  let width = 0;
  let height = 0;
  let scroll = 0;
  let pointerX = 0;
  let pointerY = 0;
  let cursorX = 0;
  let cursorY = 0;
  let easedScroll = 0;
  let lastFrame = -Infinity;
  let burstAt = -Infinity;
  let demoTimer;

  const playing = () => !player.paused && !player.ended;
  const mode = () => working ? "working" : playing() ? "playing" : "idle";

  function schedule() {
    if (!pending && ctx && width && height && visible && !document.hidden) {
      pending = requestAnimationFrame(draw);
    }
  }

  function measure() {
    const bounds = stage.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    if (!ctx || !width || !height) return;
    const scale = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    schedule();
  }

  function scrollPage() {
    const root = document.documentElement;
    const max = Math.max(1, root.scrollHeight - window.innerHeight);
    scroll = reduced.matches ? 0 : clamp01(window.scrollY / (window.innerHeight * .65));
    root.style.setProperty("--scroll-progress", reduced.matches ? "0" : clamp01(window.scrollY / max));
    if (!reduced.matches) schedule();
  }

  function audioLevel() {
    const peaks = readPeaks();
    if (!peaks?.length || !(player.duration > 0)) return 0;
    const bucket = Math.min(peaks.length - 1, Math.floor(clamp01(player.currentTime / player.duration) * peaks.length));
    return Math.sqrt(peaks[bucket]);
  }

  function drawSignal(clock, phase, heightScale, sweep) {
    const gap = width > 430 ? 6 : 7;
    const middle = height * .50;
    const drift = width * sweep;
    const samples = Math.floor(width / gap);
    for (let i = 2; i < samples - 1; i++) {
      const x = i * gap;
      const p = x / width;
      const edge = Math.sin(Math.PI * p);
      const crest = Math.sin(p * 19 - phase) + .47 * Math.sin(p * 36 + phase * .74);
      const line = middle + crest * edge * heightScale + sweep * 45 * (p - .5);
      const nearSweep = Math.max(0, 1 - Math.abs(x - drift) / (width * .20));
      const pixelY = Math.round(line / 3) * 3;

      ctx.fillStyle = "#ffc979";
      ctx.globalAlpha = .34 + nearSweep * .49 + (i % 6 === 0 ? .12 : 0);
      ctx.fillRect(x, pixelY, i % 6 === 0 ? 4 : 2.5, 3);
      if (i % 6 === 0) ctx.fillRect(x + 1, middle - 1, 1, 2);

      const echo = Math.sin(p * 15 + phase * .75) * heightScale * .55;
      ctx.fillStyle = "#fb987d";
      ctx.globalAlpha = (.30 + nearSweep * .25) * edge;
      ctx.fillRect(x, middle - height * .19 + echo, 2, 2);
      ctx.fillRect(x, middle + height * .19 - echo, 2, 2);

      if (i % 4 === 0) {
        ctx.fillStyle = "#c37073";
        ctx.globalAlpha = (.22 + .16 * Math.sin(p * 7 + clock * 1.75)) * edge;
        ctx.fillRect(x, middle + height * .30 - crest * heightScale * .36, 2, 2);
      }
    }
  }

  function drawOrbit(clock, amplitude, pulse, state, x, y) {
    const radius = Math.min(width * .31, height * .43);
    const speed = state === "working" ? 1.55 : .65;
    for (let i = 0; i < 68; i++) {
      const angle = i / 68 * TAU + clock * speed;
      const spark = (1 + Math.cos(angle * 3 - clock * 4.3)) * .5;
      const wobble = 1 + .054 * Math.sin(angle * 5 + clock * 1.8)
        + amplitude * .10 + pulse * .35;
      const px = x + Math.cos(angle) * radius * wobble;
      const py = y + Math.sin(angle) * radius * wobble * .66;
      const size = i % 11 === 0 ? 4 : 2;
      ctx.fillStyle = i % 3 === 0 ? "#fb9587" : "#ffd18a";
      ctx.globalAlpha = Math.min(.95, .14 + spark * .40 + pulse * .38 + amplitude * .11);
      ctx.fillRect(Math.round(px / 2) * 2, Math.round(py / 2) * 2, size, size);
    }
  }

  function draw(now) {
    pending = 0;
    if (!visible || document.hidden || !width || !height) return;
    const state = mode();
    const animate = !reduced.matches;
    const elapsed = now - burstAt;
    if (animate && now - lastFrame < (working ? 52 : 33)) {
      schedule();
      return;
    }
    lastFrame = animate ? now : -Infinity;
    const clock = animate ? now / 1_000 : 0;
    easedScroll = animate ? easedScroll + (scroll - easedScroll) * .23 : 0;
    cursorX = animate ? cursorX + (pointerX - cursorX) * .18 : 0;
    cursorY = animate ? cursorY + (pointerY - cursorY) * .18 : 0;
    const level = state === "playing" ? audioLevel() : state === "working" ? .37 : 0;
    const pulse = animate && elapsed >= 0 && elapsed < 980 ? (1 - elapsed / 980) ** 2 : 0;
    const capyX = cursorX * 20;
    const capyY = easedScroll * 37 + cursorY * 12 + Math.sin(clock * 2) * (animate ? 4 : 0) - pulse * 11;
    const phase = clock * (state === "working" ? 2.9 : 1.35) + easedScroll * 10 + cursorX * 3;
    const sweep = (clock * (state === "working" ? .53 : .18) + easedScroll * .7 + .22) % 1;

    ctx.clearRect(0, 0, width, height);
    drawSignal(clock, phase, height * (.10 + level * .16 + pulse * .07), sweep);
    drawOrbit(clock, level, pulse, state, width * .5 + capyX, height * .45 + capyY);
    ctx.globalAlpha = 1;
    stage.style.setProperty("--capy-x", `${capyX.toFixed(1)}px`);
    stage.style.setProperty("--capy-y", `${capyY.toFixed(1)}px`);
    stage.style.setProperty("--capy-tilt", `${(cursorX * 9 + easedScroll * 7 + pulse * -7).toFixed(1)}deg`);
    stage.style.setProperty("--capy-glow", String(1 + level * .29 + pulse * .27));
    if (animate) schedule();
  }

  function sync() {
    document.body.dataset.voiceState = mode();
    schedule();
  }

  function burst() {
    burstAt = performance.now();
    schedule();
  }

  function demo() {
    burst();
    stage.setAttribute("data-capy-demo", "");
    clearTimeout(demoTimer);
    demoTimer = setTimeout(() => {
      stage.removeAttribute("data-capy-demo");
      schedule();
    }, DEMO_MS);
  }

  if (typeof ResizeObserver === "function") new ResizeObserver(measure).observe(stage);
  else window.addEventListener("resize", measure);
  window.addEventListener("scroll", scrollPage, { passive: true });
  capy.addEventListener("click", demo);
  stage.addEventListener("pointermove", (event) => {
    if (reduced.matches || event.pointerType !== "mouse" || !width || !height) return;
    const bounds = stage.getBoundingClientRect();
    pointerX = clamp01((event.clientX - bounds.left) / width) - .5;
    pointerY = clamp01((event.clientY - bounds.top) / height) - .5;
  });
  stage.addEventListener("pointerleave", () => { pointerX = 0; pointerY = 0; });
  document.addEventListener("visibilitychange", schedule);
  reduced.addEventListener?.("change", () => {
    pointerX = 0;
    pointerY = 0;
    scrollPage();
    schedule();
  });
  for (const event of ["play", "pause", "ended", "emptied", "seeked"]) {
    player.addEventListener(event, sync);
  }

  if (typeof IntersectionObserver === "function") {
    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      stage.dataset.visible = String(visible);
      if (visible) schedule();
    });
    visibility.observe(stage);

    const reveals = new IntersectionObserver((entries) => {
      entries.forEach((entry, index) => {
        if (!entry.isIntersecting) return;
        reveals.unobserve(entry.target);
        if (reduced.matches || entry.boundingClientRect.top < window.innerHeight * .58) return;
        entry.target.animate?.([
          { opacity: .60, transform: "translateY(24px) scale(.985)" },
          { opacity: 1, transform: "translateY(0) scale(1)" },
        ], { duration: 495, delay: Math.min(index, 2) * 54, easing: "cubic-bezier(.16,.78,.26,1)", fill: "backwards" });
      });
    }, { threshold: .10 });
    document.querySelectorAll("[data-reveal]").forEach((panel) => reveals.observe(panel));
  }

  measure();
  scrollPage();
  sync();

  return {
    setWorking(value) {
      working = value;
      if (value) burst();
      sync();
    },
    ready() {
      scrollPage();
      if (reduced.matches) return;
      burst();
      document.querySelector(".audio").animate?.([
        { boxShadow: "0 0 0 0 #ffc48393, 0 0 12px #fb958728" },
        { boxShadow: "0 0 0 9px #ffc48328, 0 0 32px #fb958757", offset: .36 },
        { boxShadow: "0 0 0 16px #ffc48300, 0 0 36px #fb958700" },
      ], { duration: 860, easing: "ease-out" });
    },
  };
}
