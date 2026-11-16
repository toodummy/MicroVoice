export function createStudioMotion(player, readPeaks) {
  const stage = document.getElementById("voice-stage");
  const canvas = document.getElementById("voice-signal");
  const ctx = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let working = false;
  let visible = true;
  let pending = 0;
  let width = 0;
  let height = 0;
  let scroll = 0;
  let pointer = 0;
  let lastFrame = 0;

  const playing = () => !player.paused && !player.ended;
  function schedule() {
    if (ctx && visible && !document.hidden && !pending) pending = requestAnimationFrame(draw);
  }
  function measure() {
    const bounds = canvas.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    if (!ctx || !width || !height) return;
    const scale = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    schedule();
  }

  // The central trace is brightest. The outer traces have a smaller range.
  function paint(phase, level, travel) {
    ctx.clearRect(0, 0, width, height);
    const gap = width > 390 ? 8 : 7;
    const count = Math.floor(width / gap);
    const middle = height * .52;
    for (let i = 1; i < count; i++) {
      const x = i * gap;
      const p = x / width;
      const envelope = .25 + .75 * Math.sin(Math.PI * p);
      const wave = Math.sin(p * 20 + phase) + .52 * Math.sin(p * 44 - phase * .75);
      const y = middle + wave * envelope * level + travel * (p - .5);

      ctx.fillStyle = i % 5 === 0 ? "#eeb45d" : "#c88c49";
      ctx.globalAlpha = i % 5 === 0 ? .85 : .55;
      ctx.fillRect(x, Math.round(y / 3) * 3, i % 5 === 0 ? 5 : 3, 3);

      ctx.fillStyle = "#e88c59";
      ctx.globalAlpha = .28;
      const echo = Math.sin(p * 19 - phase * .7) * level * .55;
      ctx.fillRect(x, middle - height * .19 + echo + travel * .24, 2, 2);
      ctx.fillRect(x, middle + height * .19 - echo - travel * .24, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  function draw(now) {
    pending = 0;
    if (!visible || document.hidden || !width || !height) return;
    const live = playing() && !working && !reduced.matches;
    if (live && lastFrame && now - lastFrame < 30) {
      schedule();
      return;
    }
    lastFrame = live ? now : 0;
    const time = live ? player.currentTime : 0;
    const peaks = live ? readPeaks() : null;
    const fraction = peaks && player.duration > 0 ? Math.min(1, time / player.duration) : 0;
    const volume = peaks?.[Math.min(peaks.length - 1, Math.floor(fraction * peaks.length))] ?? 0;
    const travel = reduced.matches ? 0 : scroll * 40;
    const phase = 1.2 + travel * .17 + pointer * 3 + time * 7;
    const level = height * (.12 + (working ? .045 : 0) + Math.sqrt(volume) * .13);
    paint(phase, level, travel);
    stage.style.setProperty("--capy-shift", `${travel * .36}px`);
    stage.style.setProperty("--capy-glow", String(1 + Math.sqrt(volume) * .29));
    if (live) schedule();
  }

  function sync() {
    document.body.dataset.voiceState = working ? "working" : playing() ? "playing" : "idle";
    schedule();
  }

  function handleScroll() {
    if (reduced.matches || !visible) return;
    scroll = Math.min(1, Math.max(0, window.scrollY / Math.max(1, window.innerHeight * .45)));
    schedule();
  }

  if (typeof ResizeObserver === "function") new ResizeObserver(measure).observe(stage);
  else window.addEventListener("resize", measure);
  window.addEventListener("scroll", handleScroll, { passive: true });
  stage.addEventListener("pointermove", (event) => {
    if (reduced.matches || event.pointerType !== "mouse") return;
    pointer = event.offsetX / Math.max(1, width) - .5;
    schedule();
  });
  stage.addEventListener("pointerleave", () => {
    pointer = 0;
    schedule();
  });
  document.addEventListener("visibilitychange", schedule);
  reduced.addEventListener?.("change", () => {
    pointer = 0;
    scroll = 0;
    handleScroll();
    schedule();
  });
  for (const event of ["play", "pause", "ended", "emptied", "seeked"]) {
    player.addEventListener(event, sync);
  }

  if (typeof IntersectionObserver === "function") {
    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      stage.dataset.visible = String(visible);
      if (visible) {
        handleScroll();
        schedule();
      }
    });
    visibility.observe(stage);

    const reveals = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        reveals.unobserve(entry.target);
        if (reduced.matches || entry.boundingClientRect.top < window.innerHeight * .65) continue;
        entry.target.animate?.(
          [{ opacity: .8, transform: "translateY(14px)" }, { opacity: 1, transform: "translateY(0)" }],
          { duration: 360, easing: "cubic-bezier(.2,.65,.3,1)" },
        );
      }
    }, { threshold: .12 });
    document.querySelectorAll("[data-reveal]").forEach((panel) => reveals.observe(panel));
  }

  measure();
  handleScroll();
  sync();

  return {
    setWorking(value) {
      working = value;
      sync();
    },
    ready() {
      if (reduced.matches) return;
      document.querySelector(".audio").animate?.([
        { boxShadow: "0 0 0 0 #f8c77569" },
        { boxShadow: "0 0 0 10px #f8c77500" },
      ], { duration: 640, easing: "ease-out" });
    },
  };
}
