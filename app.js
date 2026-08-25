(() => {
  const FRAME_COUNT = 240;
  const FRAME_PREFIX = "frames/frame_";
  const FRAME_EXT = ".webp";
  const PAD_LENGTH = 6;
  const INITIAL_BUFFER_TARGET = 8; // Instant unlock upon loading first 8 frames (~180KB)

  // Default Physics Parameters
  const DEFAULTS = {
    lerpFactor: 0.12,
    trackHeightVh: 550,
    easing: "linear",
    isInverted: false,
    autoPlay: false,
    autoPlaySpeed: 1.0,
  };

  const PRESETS = {
    apple: { lerpFactor: 0.12, trackHeightVh: 550, easing: "linear" },
    snappy: { lerpFactor: 0.28, trackHeightVh: 350, easing: "linear" },
    cinematic: { lerpFactor: 0.045, trackHeightVh: 850, easing: "smoothstep" },
    slowmo: { lerpFactor: 0.08, trackHeightVh: 1300, easing: "linear" },
  };

  // State
  let physics = { ...DEFAULTS };
  let currentProgress = 0;
  let targetProgress = 0;
  let lastProgress = 0;
  let lastRenderedIndex = -1;
  let isReady = false;
  let autoPlayDirection = 1;

  // Telemetry metrics
  let frameTimes = [];
  let currentFps = 60;
  let scrubVelocity = 0;

  // DOM Elements
  const canvas = document.getElementById("animation-canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const loader = document.getElementById("loader");
  const progressBar = document.getElementById("progress-bar");
  const progressText = document.getElementById("progress-text");
  const scrollCue = document.getElementById("scroll-cue");
  const scrollTrack = document.getElementById("scroll-track");

  // HUD Elements
  const hud = document.getElementById("physics-hud");
  const hudToggleBtn = document.getElementById("hud-toggle-btn");
  const hudCloseBtn = document.getElementById("hud-close-btn");
  const presetButtons = document.querySelectorAll(".preset-btn");
  const lerpSlider = document.getElementById("lerp-slider");
  const lerpVal = document.getElementById("lerp-val");
  const trackHeightSlider = document.getElementById("track-height-slider");
  const trackHeightVal = document.getElementById("track-height-val");
  const easingSelect = document.getElementById("easing-select");
  const autoplayToggle = document.getElementById("autoplay-toggle");
  const autoplaySpeedControl = document.getElementById("autoplay-speed-control");
  const autoplaySpeedSlider = document.getElementById("autoplay-speed");
  const autoplaySpeedVal = document.getElementById("autoplay-speed-val");
  const invertToggle = document.getElementById("invert-toggle");
  const resetBtn = document.getElementById("reset-btn");
  const jumpStartBtn = document.getElementById("jump-start-btn");
  const jumpEndBtn = document.getElementById("jump-end-btn");

  // Telemetry DOM
  const telemFrame = document.getElementById("telem-frame");
  const telemProgress = document.getElementById("telem-progress");
  const telemFps = document.getElementById("telem-fps");
  const telemVelocity = document.getElementById("telem-velocity");

  const images = new Array(FRAME_COUNT);
  let loadedCount = 0;
  let initialBufferLoaded = 0;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let dpr = 1;

  function getFramePath(index) {
    return `${FRAME_PREFIX}${String(index).padStart(PAD_LENGTH, "0")}${FRAME_EXT}`;
  }

  function updateLoaderProgress(customPercent) {
    let percent = typeof customPercent === "number" ? Math.min(100, Math.max(0, Math.round(customPercent))) : 100;
    if (progressBar) progressBar.style.width = `${percent}%`;
    if (progressText) progressText.textContent = `${percent}%`;
  }

  function unlockPreloader() {
    if (isReady) return;
    isReady = true;
    updateLoaderProgress(100);
    if (loader) {
      loader.classList.add("loaded");
    }
    renderFrame(0);
  }

  function startFastVisualCounter() {
    const startTime = performance.now();
    const duration = 280; // 280ms lightning-fast smooth countdown

    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const val = Math.floor(eased * 100);
      updateLoaderProgress(val);

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        unlockPreloader();
      }
    }
    requestAnimationFrame(step);
  }

  function preloadImages() {
    // Start instant 280ms visual progress bar
    startFastVisualCounter();

    // High priority load frame 0
    const firstImg = new Image();
    firstImg.src = getFramePath(0);
    firstImg.onload = () => {
      images[0] = firstImg;
      loadedCount++;
      renderFrame(0);
    };
    firstImg.onerror = () => {
      loadedCount++;
    };

    // Load initial 10 frames in parallel
    for (let i = 1; i <= 10; i++) {
      const img = new Image();
      img.src = getFramePath(i);
      img.onload = () => {
        images[i] = img;
        loadedCount++;
      };
      img.onerror = () => {
        loadedCount++;
      };
    }

    // Stream remaining frames progressively in background
    setTimeout(() => {
      streamRemainingFrames();
    }, 50);
  }

  // Progressive background frame loader using small concurrent batches
  function streamRemainingFrames() {
    const queue = [];
    // Enqueue keyframes first (every 4th frame: 12, 16, 20...) for instant full-timeline coverage
    for (let i = 12; i < FRAME_COUNT; i += 4) {
      queue.push(i);
    }
    // Then fill remaining in-between frames
    for (let i = 11; i < FRAME_COUNT; i++) {
      if (i % 4 !== 0) {
        queue.push(i);
      }
    }

    const CONCURRENCY = 6;
    let running = 0;
    let qIdx = 0;

    function processQueue() {
      while (running < CONCURRENCY && qIdx < queue.length) {
        const frameIdx = queue[qIdx++];
        if (images[frameIdx]) continue;

        running++;
        const img = new Image();
        img.src = getFramePath(frameIdx);
        img.onload = () => {
          images[frameIdx] = img;
          loadedCount++;
          running--;
          processQueue();
        };
        img.onerror = () => {
          loadedCount++;
          running--;
          processQueue();
        };
      }
    }
    processQueue();
  }

  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvasWidth = window.innerWidth;
    canvasHeight = window.innerHeight;

    canvas.width = Math.floor(canvasWidth * dpr);
    canvas.height = Math.floor(canvasHeight * dpr);
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    lastRenderedIndex = -1;
    renderFrame(Math.min(FRAME_COUNT - 1, Math.max(0, Math.round(currentProgress * (FRAME_COUNT - 1)))));
  }

  // Smart fallback: returns closest loaded frame to avoid blank flashes during fast scrolls
  function getClosestLoadedImage(targetIdx) {
    if (images[targetIdx] && images[targetIdx].complete && images[targetIdx].naturalWidth > 0) {
      return images[targetIdx];
    }
    for (let dist = 1; dist < FRAME_COUNT; dist++) {
      const prev = targetIdx - dist;
      if (prev >= 0 && images[prev] && images[prev].complete && images[prev].naturalWidth > 0) {
        return images[prev];
      }
      const next = targetIdx + dist;
      if (next < FRAME_COUNT && images[next] && images[next].complete && images[next].naturalWidth > 0) {
        return images[next];
      }
    }
    return null;
  }

  function renderFrame(index) {
    const clampedIndex = Math.min(FRAME_COUNT - 1, Math.max(0, index));
    const img = getClosestLoadedImage(clampedIndex);
    if (!img || !img.complete || img.naturalWidth === 0) return;

    const imgWidth = img.naturalWidth;
    const imgHeight = img.naturalHeight;

    const scale = Math.max(canvasWidth / imgWidth, canvasHeight / imgHeight);
    const drawWidth = imgWidth * scale;
    const drawHeight = imgHeight * scale;
    const offsetX = (canvasWidth - drawWidth) / 2;
    const offsetY = (canvasHeight - drawHeight) / 2;

    ctx.fillStyle = "#070709";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

    lastRenderedIndex = clampedIndex;
  }

  // Easing Functions
  function applyEasing(t, type) {
    const clamped = Math.min(1, Math.max(0, t));
    switch (type) {
      case "smoothstep":
        return clamped * clamped * (3 - 2 * clamped);
      case "easeOutQuad":
        return 1 - (1 - clamped) * (1 - clamped);
      case "linear":
      default:
        return clamped;
    }
  }

  function calculateRawScrollProgress() {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    if (maxScroll <= 0) return 0;
    let norm = Math.min(1, Math.max(0, window.scrollY / maxScroll));
    if (physics.isInverted) {
      norm = 1 - norm;
    }
    return norm;
  }

  function setScrollProgress(progress) {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const p = physics.isInverted ? 1 - progress : progress;
    window.scrollTo({ top: p * maxScroll, behavior: "instant" });
  }

  function updateTrackHeight(vh) {
    physics.trackHeightVh = vh;
    if (scrollTrack) {
      const prevProgress = currentProgress;
      scrollTrack.style.height = `${vh}vh`;
      // Maintain approximate view position
      setScrollProgress(prevProgress);
    }
    if (trackHeightVal) trackHeightVal.textContent = `${vh}vh`;
    if (trackHeightSlider) trackHeightSlider.value = vh;
  }

  function applyPreset(presetKey) {
    const preset = PRESETS[presetKey];
    if (!preset) return;

    physics.lerpFactor = preset.lerpFactor;
    physics.easing = preset.easing;
    updateTrackHeight(preset.trackHeightVh);

    if (lerpSlider) lerpSlider.value = physics.lerpFactor;
    if (lerpVal) lerpVal.textContent = physics.lerpFactor.toFixed(2);
    if (easingSelect) easingSelect.value = physics.easing;

    presetButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-preset") === presetKey);
    });
  }

  function checkCustomPreset() {
    let matched = null;
    for (const [key, p] of Object.entries(PRESETS)) {
      if (
        Math.abs(p.lerpFactor - physics.lerpFactor) < 0.001 &&
        p.trackHeightVh === physics.trackHeightVh &&
        p.easing === physics.easing
      ) {
        matched = key;
        break;
      }
    }
    presetButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-preset") === matched);
    });
  }

  function updateTelemetry(now) {
    // FPS Calculation
    frameTimes.push(now);
    if (frameTimes.length > 30) {
      frameTimes.shift();
    }
    if (frameTimes.length > 1) {
      const deltaSec = (frameTimes[frameTimes.length - 1] - frameTimes[0]) / 1000;
      currentFps = Math.round((frameTimes.length - 1) / deltaSec);
    }

    // Velocity
    scrubVelocity = Math.abs(currentProgress - lastProgress);
    lastProgress = currentProgress;

    const frameIdx = Math.min(
      FRAME_COUNT - 1,
      Math.max(0, Math.round(currentProgress * (FRAME_COUNT - 1)))
    );

    if (telemFrame) {
      telemFrame.textContent = `${String(frameIdx).padStart(3, "0")} / ${FRAME_COUNT - 1}`;
    }
    if (telemProgress) {
      telemProgress.textContent = `${(currentProgress * 100).toFixed(1)}%`;
    }
    if (telemFps) {
      telemFps.textContent = `${currentFps}`;
    }
    if (telemVelocity) {
      telemVelocity.textContent = scrubVelocity.toFixed(4);
    }
  }

  function tick(timestamp) {
    if (!isReady) return;

    // Pause heavy canvas rendering when full-screen video showreel modal is active
    const modalActive = document.querySelector(".project-modal-backdrop.open");
    if (modalActive) {
      requestAnimationFrame(tick);
      return;
    }

    if (physics.autoPlay) {
      // Auto-loop scrubber
      const speedDelta = (0.0025 * physics.autoPlaySpeed);
      let nextP = currentProgress + (speedDelta * autoPlayDirection);
      if (nextP >= 1) {
        nextP = 1;
        autoPlayDirection = -1;
      } else if (nextP <= 0) {
        nextP = 0;
        autoPlayDirection = 1;
      }
      setScrollProgress(nextP);
      targetProgress = nextP;
    } else {
      const rawProgress = calculateRawScrollProgress();
      targetProgress = applyEasing(rawProgress, physics.easing);
    }

    // Lerp Physics Engine
    currentProgress += (targetProgress - currentProgress) * physics.lerpFactor;

    if (Math.abs(targetProgress - currentProgress) < 0.0001) {
      currentProgress = targetProgress;
    }

    const targetFrameIndex = Math.min(
      FRAME_COUNT - 1,
      Math.max(0, Math.round(currentProgress * (FRAME_COUNT - 1)))
    );

    if (targetFrameIndex !== lastRenderedIndex) {
      renderFrame(targetFrameIndex);
    }

    // Update Telemetry
    updateTelemetry(timestamp || performance.now());

    // Toggle scroll cue
    if (scrollCue) {
      if (window.scrollY > 40 || physics.autoPlay) {
        scrollCue.classList.add("hidden");
      } else {
        scrollCue.classList.remove("hidden");
      }
    }

    requestAnimationFrame(tick);
  }

  // Bind HUD & Controls
  function initControls() {
    // HUD Toggle
    const toggleHud = () => {
      const isMin = hud.classList.toggle("minimized");
      hudToggleBtn.classList.toggle("active", !isMin);
    };

    if (hudToggleBtn) hudToggleBtn.addEventListener("click", toggleHud);
    if (hudCloseBtn) hudCloseBtn.addEventListener("click", toggleHud);

    // Presets
    presetButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const pKey = btn.getAttribute("data-preset");
        applyPreset(pKey);
      });
    });

    // Lerp Slider
    if (lerpSlider) {
      lerpSlider.addEventListener("input", (e) => {
        physics.lerpFactor = parseFloat(e.target.value);
        if (lerpVal) lerpVal.textContent = physics.lerpFactor.toFixed(2);
        checkCustomPreset();
      });
    }

    // Track Height Slider
    if (trackHeightSlider) {
      trackHeightSlider.addEventListener("input", (e) => {
        const val = parseInt(e.target.value, 10);
        updateTrackHeight(val);
        checkCustomPreset();
      });
    }

    // Easing Dropdown
    if (easingSelect) {
      easingSelect.addEventListener("change", (e) => {
        physics.easing = e.target.value;
        checkCustomPreset();
      });
    }

    // Auto Play Toggle
    if (autoplayToggle) {
      autoplayToggle.addEventListener("change", (e) => {
        physics.autoPlay = e.target.checked;
        if (autoplaySpeedControl) {
          autoplaySpeedControl.classList.toggle("hidden", !physics.autoPlay);
        }
      });
    }

    // Auto Play Speed
    if (autoplaySpeedSlider) {
      autoplaySpeedSlider.addEventListener("input", (e) => {
        physics.autoPlaySpeed = parseFloat(e.target.value);
        if (autoplaySpeedVal) autoplaySpeedVal.textContent = `${physics.autoPlaySpeed.toFixed(1)}x`;
      });
    }

    // Invert Toggle
    if (invertToggle) {
      invertToggle.addEventListener("change", (e) => {
        physics.isInverted = e.target.checked;
      });
    }

    // Navigation Jump Buttons
    if (jumpStartBtn) {
      jumpStartBtn.addEventListener("click", () => {
        setScrollProgress(0);
      });
    }

    if (jumpEndBtn) {
      jumpEndBtn.addEventListener("click", () => {
        setScrollProgress(1);
      });
    }

    // Reset Defaults
    const resetDefaults = () => {
      physics = { ...DEFAULTS };
      applyPreset("apple");
      if (invertToggle) invertToggle.checked = false;
      if (autoplayToggle) {
        autoplayToggle.checked = false;
        autoplaySpeedControl.classList.add("hidden");
      }
    };

    if (resetBtn) resetBtn.addEventListener("click", resetDefaults);

    // Keyboard Shortcuts
    window.addEventListener("keydown", (e) => {
      // Don't trigger when typing in inputs/selects
      if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) {
        return;
      }

      if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        toggleHud();
      } else if (e.code === "Space") {
        e.preventDefault();
        if (autoplayToggle) {
          autoplayToggle.checked = !autoplayToggle.checked;
          autoplayToggle.dispatchEvent(new Event("change"));
        }
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        resetDefaults();
      } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        const nextIdx = Math.min(FRAME_COUNT - 1, Math.round(currentProgress * (FRAME_COUNT - 1)) + 1);
        setScrollProgress(nextIdx / (FRAME_COUNT - 1));
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        const prevIdx = Math.max(0, Math.round(currentProgress * (FRAME_COUNT - 1)) - 1);
        setScrollProgress(prevIdx / (FRAME_COUNT - 1));
      }
    });
  }

  // ========================================================
  // 🎬 PORTFOLIO VIDEO CONFIGURATION (YOUTUBE OR LOCAL FILES)
  // Paste any YouTube Video URL, YouTube Short, or local path here!
  // ========================================================
  window.PORTFOLIO_VIDEOS = window.PORTFOLIO_VIDEOS || {
    // Works Modal Videos (16:9 Landscape)
    project1: "assets/video1.mp4",
    project2: "assets/video2.mp4",
    project3: "assets/video3.mp4",

    // Typography Card 1: 9:16 Vertical Reels / YouTube Shorts
    reel01: "assets/video5.mp4",
    reel02: "assets/video6.mp4",

    // Typography Card 2: 16:9 Cinematic Titles Video
    cinematicTitles: "assets/video4.mp4",

    // Typography Card 3: 16:9 Long-Form YouTube Video
    longForm: "assets/video7.mp4",
  };

  // Helper: Extract YouTube ID from any YouTube URL or direct ID
  function extractYouTubeId(urlOrId) {
    if (!urlOrId || typeof urlOrId !== "string") return null;
    const trimmed = urlOrId.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      return trimmed;
    }
    const shortsMatch = trimmed.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shortsMatch) return shortsMatch[1];
    const watchMatch = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (watchMatch) return watchMatch[1];
    const youtuMatch = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (youtuMatch) return youtuMatch[1];
    const embedMatch = trimmed.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
    if (embedMatch) return embedMatch[1];
    return null;
  }

  // Universal Media Renderer: Embeds YouTube iframe or HTML5 Video element
  function renderMediaToContainer(container, src, options = {}) {
    if (!container || !src) return;
    const { autoplay = true, muted = false, loop = true, controls = true, poster = "" } = options;
    const ytId = extractYouTubeId(src);

    if (ytId) {
      const autoPlayParam = autoplay ? "1" : "0";
      const muteParam = muted ? "1" : "0";
      const loopParam = loop ? `&loop=1&playlist=${ytId}` : "";
      const controlsParam = controls ? "1" : "0";
      const embedUrl = `https://www.youtube-nocookie.com/embed/${ytId}?autoplay=${autoPlayParam}&mute=${muteParam}&playsinline=1&rel=0&modestbranding=1&controls=${controlsParam}${loopParam}`;

      container.innerHTML = `
        <iframe 
          class="media-embed-iframe" 
          src="${embedUrl}" 
          title="YouTube video player" 
          frameborder="0" 
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
          allowfullscreen>
        </iframe>
      `;
    } else {
      const autoAttr = autoplay ? "autoplay" : "";
      const muteAttr = muted ? "muted" : "";
      const loopAttr = loop ? "loop" : "";
      const ctrlAttr = controls ? "controls" : "";
      const posterAttr = poster ? `poster="${poster}"` : "";

      container.innerHTML = `
        <video class="main-video-element" ${ctrlAttr} ${autoAttr} ${muteAttr} ${loopAttr} playsinline ${posterAttr}>
          <source src="${src}" type="video/mp4">
          <source src="${src}" type="video/quicktime">
          Your browser does not support HTML5 video.
        </video>
      `;
      const videoEl = container.querySelector("video");
      if (videoEl && autoplay) {
        const p = videoEl.play();
        if (p) p.catch(() => {});
      }
    }
  }

  // Cinematic Video Showcase Player Controller
  function initProjectModals() {
    const projectModal = document.getElementById("project-modal");
    const modalCloseBtn = document.getElementById("modal-close-btn");
    const openBtns = document.querySelectorAll(".btn-open-project-modal, #start-project-btn, #footer-showreel-btn");
    const playlistItems = document.querySelectorAll(".playlist-item-card");
    const playerWrapper = document.querySelector(".showcase-player-wrapper");
    const mainTitle = document.getElementById("showcase-main-title");
    const mainDesc = document.getElementById("showcase-main-desc");
    const statusBadge = document.getElementById("showcase-status-badge");

    // Open Video Player Modal
    const openVideoModal = (src, poster, title, badge, desc) => {
      // Pause ALL background videos on the page so 100% decoder bandwidth goes to showreel
      document.querySelectorAll("video").forEach((v) => {
        if (!v.closest(".showcase-player-wrapper")) {
          v.pause();
        }
      });

      if (mainTitle && title) mainTitle.textContent = title;
      if (statusBadge && badge) statusBadge.textContent = badge;
      if (mainDesc && desc) mainDesc.textContent = desc;

      if (src && playerWrapper) {
        renderMediaToContainer(playerWrapper, src, { autoplay: true, muted: false, loop: true, poster: poster });
      }

      if (projectModal) {
        projectModal.classList.add("open");
        document.body.style.overflow = "hidden";
      }
    };

    // Close Video Player Modal
    const closeVideoModal = () => {
      if (projectModal) {
        projectModal.classList.remove("open");
        document.body.style.overflow = "";
      }
      if (playerWrapper) {
        const v = playerWrapper.querySelector("video");
        if (v) v.pause();
      }
    };

    openBtns.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        if (e) e.preventDefault();
        const clickedCard = btn.closest(".btn-open-project-modal") || btn;
        let src = clickedCard.getAttribute("data-video-src");
        let poster = clickedCard.getAttribute("data-poster");
        let title = clickedCard.getAttribute("data-title");
        let badge = clickedCard.getAttribute("data-badge");
        let desc = clickedCard.getAttribute("data-desc");

        if (src) {
          // Sync playlist active class
          playlistItems.forEach((item) => {
            if (item.getAttribute("data-video-src") === src) {
              item.classList.add("active");
            } else {
              item.classList.remove("active");
            }
          });
        } else {
          const activeItem = document.querySelector(".playlist-item-card.active") || playlistItems[0];
          if (activeItem) {
            src = activeItem.getAttribute("data-video-src") || window.PORTFOLIO_VIDEOS.project1;
            poster = activeItem.getAttribute("data-poster");
            title = activeItem.getAttribute("data-title");
            badge = activeItem.getAttribute("data-badge");
            desc = activeItem.getAttribute("data-desc");
          }
        }

        if (src) {
          openVideoModal(src, poster, title, badge, desc);
        }
      });
    });

    if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeVideoModal);

    if (projectModal) {
      projectModal.addEventListener("click", (e) => {
        if (e.target === projectModal) closeVideoModal();
      });
    }

    // Playlist Item Selection
    playlistItems.forEach((item) => {
      item.addEventListener("click", () => {
        playlistItems.forEach((i) => i.classList.remove("active"));
        item.classList.add("active");

        const src = item.getAttribute("data-video-src");
        const poster = item.getAttribute("data-poster");
        const title = item.getAttribute("data-title");
        const badge = item.getAttribute("data-badge");
        const desc = item.getAttribute("data-desc");

        openVideoModal(src, poster, title, badge, desc);
      });
    });

    // Escape key closes modal
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeVideoModal();
      }
    });
  }

  // Interactive 3D Card Hover Tilt Effect
  function initTiltEffect() {
    const tiltCards = document.querySelectorAll("[data-tilt]");
    tiltCards.forEach((card) => {
      card.addEventListener("mousemove", (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = ((y - centerY) / centerY) * -7;
        const rotateY = ((x - centerX) / centerX) * 7;
        card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-8px) scale(1.02)`;
      });

      card.addEventListener("mouseleave", () => {
        card.style.transform = "";
      });
    });
  }

  // Viral Reel 9:16 Video Switcher & Theater Modal Controller
  function initViralReelSwitcher() {
    const reelTabs = document.querySelectorAll(".reel-tab-btn");
    const reelContainer = document.querySelector(".reel-phone-frame");
    const expandBtn = document.getElementById("expand-reel-btn");

    const verticalModal = document.getElementById("vertical-reel-modal");
    const verticalCloseBtn = document.getElementById("vertical-modal-close-btn");
    const theaterContainer = document.querySelector(".vertical-theater-phone");
    const theaterTabs = document.querySelectorAll(".theater-tab-btn");

    let currentReelSrc = window.PORTFOLIO_VIDEOS.reel01 || "assets/video5.mp4";

    // Initialize Card 1 Phone Player if configured
    const initCardReel = () => {
      const activeTab = document.querySelector(".reel-tab-btn.active") || reelTabs[0];
      if (activeTab) {
        currentReelSrc = activeTab.getAttribute("data-src") || window.PORTFOLIO_VIDEOS.reel01;
      }
    };
    initCardReel();

    // Card Reel Tabs
    reelTabs.forEach((tab, index) => {
      tab.addEventListener("click", () => {
        reelTabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");

        const newSrc = tab.getAttribute("data-src") || (index === 0 ? window.PORTFOLIO_VIDEOS.reel01 : window.PORTFOLIO_VIDEOS.reel02);
        currentReelSrc = newSrc;

        // If local video tag exists inside reel frame, update it
        const viralPlayer = document.getElementById("viral-reel-player");
        const viralSource = document.getElementById("viral-reel-source");
        if (extractYouTubeId(newSrc)) {
          // If YouTube Short, embed inside phone container
          if (reelContainer) {
            renderMediaToContainer(reelContainer, newSrc, { autoplay: true, muted: true, loop: true, controls: true });
          }
        } else if (viralPlayer && viralSource) {
          viralSource.setAttribute("src", newSrc);
          viralPlayer.load();
          const playPromise = viralPlayer.play();
          if (playPromise) playPromise.catch(() => {});
        }

        // Sync theater tabs if open
        if (theaterTabs[index]) {
          theaterTabs.forEach((t) => t.classList.remove("active"));
          theaterTabs[index].classList.add("active");
        }
      });
    });

    // Expand to Large 9:16 Theater Modal
    if (expandBtn && verticalModal && theaterContainer) {
      expandBtn.addEventListener("click", (e) => {
        if (e) e.stopPropagation();
        renderMediaToContainer(theaterContainer, currentReelSrc, { autoplay: true, muted: false, loop: true, controls: true });
        verticalModal.classList.add("open");
        document.body.style.overflow = "hidden";
      });
    }

    // Close Theater Modal
    const closeTheaterModal = () => {
      if (verticalModal) {
        verticalModal.classList.remove("open");
        document.body.style.overflow = "";
      }
      if (theaterContainer) {
        theaterContainer.innerHTML = `
          <div class="reel-phone-notch"></div>
          <video id="theater-reel-player" class="theater-reel-video" controls playsinline loop>
            <source id="theater-reel-source" src="" type="video/mp4">
          </video>
        `;
      }
    };

    if (verticalCloseBtn) verticalCloseBtn.addEventListener("click", closeTheaterModal);

    if (verticalModal) {
      verticalModal.addEventListener("click", (e) => {
        if (e.target === verticalModal) closeTheaterModal();
      });
    }

    // Theater Tabs Switcher
    theaterTabs.forEach((tab, index) => {
      tab.addEventListener("click", () => {
        theaterTabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");

        const newSrc = tab.getAttribute("data-src") || (index === 0 ? window.PORTFOLIO_VIDEOS.reel01 : window.PORTFOLIO_VIDEOS.reel02);
        currentReelSrc = newSrc;

        if (theaterContainer) {
          renderMediaToContainer(theaterContainer, currentReelSrc, { autoplay: true, muted: false, loop: true, controls: true });
        }

        // Sync card tabs
        if (reelTabs[index]) {
          reelTabs.forEach((t) => t.classList.remove("active"));
          reelTabs[index].classList.add("active");
        }
      });
    });
  }

  // Initialize Typography Video Card Players (Card 2 & Card 3)
  function initTypographyCardPlayers() {
    // Card 2: Cinematic Titles
    const cinematicFrame = document.querySelector(".typo-cinematic-card:nth-child(2) .cinematic-player-frame");
    if (cinematicFrame && extractYouTubeId(window.PORTFOLIO_VIDEOS.cinematicTitles)) {
      renderMediaToContainer(cinematicFrame, window.PORTFOLIO_VIDEOS.cinematicTitles, { autoplay: true, muted: true, loop: true });
    }

    // Card 3: Long-Form Video Editing
    const launchFrame = document.querySelector(".launch-player-frame");
    if (launchFrame && extractYouTubeId(window.PORTFOLIO_VIDEOS.longForm)) {
      renderMediaToContainer(launchFrame, window.PORTFOLIO_VIDEOS.longForm, { autoplay: true, muted: true, loop: true });
    }
  }

  // Smart IntersectionObserver: Only plays video when visible on screen, pauses when scrolled out
  function initSmartVideoObserver() {
    const cardVideos = document.querySelectorAll(".reel-video-element, .cinematic-video-element");
    if (!("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver((entries) => {
      const modalOpen = document.querySelector(".project-modal-backdrop.open");
      entries.forEach((entry) => {
        const video = entry.target;
        if (entry.isIntersecting && !modalOpen) {
          const playPromise = video.play();
          if (playPromise) playPromise.catch(() => {});
        } else {
          video.pause();
        }
      });
    }, { threshold: 0.35 });

    cardVideos.forEach((v) => observer.observe(v));
  }

  // Initialization
  async function init() {
    initControls();
    initProjectModals();
    initTiltEffect();
    initViralReelSwitcher();
    initTypographyCardPlayers();
    initSmartVideoObserver();
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas, { passive: true });
    window.addEventListener("orientationchange", () => {
      setTimeout(resizeCanvas, 150);
    }, { passive: true });

    // Start progressive image preloader and buffer engine
    preloadImages();

    // Start animation loop
    requestAnimationFrame(tick);
  }

  // Start when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

