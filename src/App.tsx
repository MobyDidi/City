import { useEffect, useRef } from 'react';
import {
  buildProxyUrl,
  computeHeroGeometry,
  FACADE_S_LUT,
  HeroGeometry,
  LEDGE_TOP_LUT,
  NIGHT_AMOUNT_LUT,
  PAN_LUT,
  PIECE_P_LUT,
  sampleLut,
  selectProxyWidth,
  SOURCE_URLS,
  STREET_PIECES,
  StreetPieceDef,
} from './nocheVivaData';
import { createStreetRenderer, StreetRenderer } from './webglStreet';

function loadCorsImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      if (typeof img.decode === 'function') {
        img.decode().then(
          () => resolve(img),
          () => resolve(img),
        );
      } else {
        resolve(img);
      }
    };
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

export default function App() {
  const heroRef = useRef<HTMLElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const worldDayRef = useRef<HTMLImageElement>(null);
  const worldNightRef = useRef<HTMLImageElement>(null);
  const layersRef = useRef<HTMLDivElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const leftHalfRef = useRef<HTMLDivElement>(null);
  const rightHalfRef = useRef<HTMLDivElement>(null);
  const leftImgRef = useRef<HTMLImageElement>(null);
  const rightImgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }
    window.scrollTo(0, 0);

    const heroEl = heroRef.current;
    const worldEl = worldRef.current;
    const worldDayEl = worldDayRef.current;
    const worldNightEl = worldNightRef.current;
    const layersEl = layersRef.current;
    const bandEl = bandRef.current;
    const titleEl = titleRef.current;
    const leftHalfEl = leftHalfRef.current;
    const rightHalfEl = rightHalfRef.current;
    const leftImgEl = leftImgRef.current;
    const rightImgEl = rightImgRef.current;

    if (
      !heroEl ||
      !worldEl ||
      !worldDayEl ||
      !worldNightEl ||
      !layersEl ||
      !bandEl ||
      !titleEl ||
      !leftHalfEl ||
      !rightHalfEl ||
      !leftImgEl ||
      !rightImgEl
    ) {
      return;
    }

    let cancelled = false;
    let renderer: StreetRenderer | null = null;
    let ready = false;
    let fallbackMode = false;
    let introStartTime = 0;
    let sCur = 0;
    let vel = 0;
    let rafId = 0;
    let lastTickTime = 0;
    let resizeTimer = 0;

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reducedMotion = motionQuery.matches;

    const measureHero = (): { W: number; H: number } => {
      const rect = heroEl.getBoundingClientRect();
      return {
        W: rect.width || window.innerWidth,
        H: rect.height || window.innerHeight,
      };
    };

    let { W: initW, H: initH } = measureHero();
    let geo: HeroGeometry = computeHeroGeometry(initW, initH);

    const dpr = window.devicePixelRatio || 1;
    const streetCssW = Math.max(initW, initH * 1.26 * 1.506);
    const facadeCssW = Math.max(initW, initH * 1.5);
    const bandCssW = initW;

    const dayUrl = buildProxyUrl(SOURCE_URLS.day, selectProxyWidth(streetCssW, dpr, true));
    const nightUrl = buildProxyUrl(SOURCE_URLS.night, selectProxyWidth(streetCssW, dpr, true));
    const facadeUrl = buildProxyUrl(SOURCE_URLS.facade, selectProxyWidth(facadeCssW, dpr, false));
    const bandUrl = buildProxyUrl(SOURCE_URLS.band, selectProxyWidth(bandCssW, dpr, false));

    leftImgEl.src = facadeUrl;
    rightImgEl.src = facadeUrl;
    worldDayEl.src = dayUrl;
    worldNightEl.src = nightUrl;
    bandEl.style.backgroundImage = `url("${bandUrl}")`;

    const applyStaticGeometry = (g: HeroGeometry) => {
      const halfWidth = Math.max(0, g.W / 2 - g.gap);
      const imgTop = (g.H - g.fh) / 2;

      leftHalfEl.style.width = `${halfWidth}px`;
      leftImgEl.style.width = `${g.fw}px`;
      leftImgEl.style.height = `${g.fh}px`;
      leftImgEl.style.left = `${halfWidth - g.fw / 2}px`;
      leftImgEl.style.top = `${imgTop}px`;

      rightHalfEl.style.width = `${halfWidth}px`;
      rightImgEl.style.width = `${g.fw}px`;
      rightImgEl.style.height = `${g.fh}px`;
      rightImgEl.style.left = `${-g.fw / 2}px`;
      rightImgEl.style.top = `${imgTop}px`;

      bandEl.style.height = `${g.bandHeight}px`;
      titleEl.style.fontSize = `${g.titleFontSize}px`;
      titleEl.style.top = `${g.titleTop}px`;

      worldDayEl.style.left = `${g.px}px`;
      worldDayEl.style.width = `${g.pw}px`;
      worldDayEl.style.height = `${g.ph}px`;
      worldNightEl.style.left = `${g.px}px`;
      worldNightEl.style.width = `${g.pw}px`;
      worldNightEl.style.height = `${g.ph}px`;
    };

    applyStaticGeometry(geo);

    const offsets: Record<StreetPieceDef['id'], number> = {
      A: 0,
      B: 0,
      C: 0,
      D: 0,
      E: 0,
      F: 0,
      G: 0,
      H: 0,
    };

    const getScrollProgress = (): number => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll <= 0) return 0;
      return Math.max(0, Math.min(1, window.scrollY / maxScroll));
    };

    const renderFrame = (now: number, dt: number) => {
      let sFacade = 0;
      let blocksGone = false;
      let introDone = false;

      if (fallbackMode || reducedMotion) {
        introDone = true;
        blocksGone = true;
        for (const piece of STREET_PIECES) {
          offsets[piece.id] = 0;
        }
      } else if (!ready) {
        introDone = false;
        blocksGone = false;
        sFacade = 0;
        for (const piece of STREET_PIECES) {
          offsets[piece.id] = piece.side * geo.travels[piece.id];
        }
      } else {
        const T = (now - introStartTime) / 1000 - 0.4;
        sFacade = sampleLut(FACADE_S_LUT, T * 30);
        blocksGone = sFacade * geo.W > geo.W / 2 + 2;
        introDone = T >= 1.17;

        for (const piece of STREET_PIECES) {
          const p = introDone
            ? 1
            : sampleLut(PIECE_P_LUT, (T + geo.leads[piece.id]) * 30);
          offsets[piece.id] = piece.side * (1 - p) * geo.travels[piece.id];
        }
      }

      const sp = getScrollProgress();
      const targetSp = introDone ? sp : 0;

      if (reducedMotion) {
        sCur = targetSp;
        vel = 0;
      } else {
        const a = 81 * (targetSp - sCur) - 18 * vel;
        vel += a * dt;
        sCur += vel * dt;
        if (Math.abs(targetSp - sCur) < 1e-4 && Math.abs(vel) < 1e-4) {
          sCur = targetSp;
          vel = 0;
        }
      }

      const k = 113 + sCur * 35;
      const nightAmount = sampleLut(NIGHT_AMOUNT_LUT, k - 113);
      const pan = sampleLut(PAN_LUT, k - 116);
      const bandTop = sampleLut(LEDGE_TOP_LUT, k - 137);

      if (fallbackMode) {
        leftHalfEl.style.display = 'none';
        rightHalfEl.style.display = 'none';
        layersEl.style.display = 'none';
        layersEl.style.clipPath = '';
        worldEl.classList.add('is-fallback');
        worldEl.style.transform = `translate3d(0, ${-0.2 * pan * geo.H}px, 0)`;
        worldNightEl.style.opacity = String(nightAmount);
      } else {
        if (blocksGone) {
          leftHalfEl.style.display = 'none';
          rightHalfEl.style.display = 'none';
          layersEl.style.clipPath = '';
        } else {
          leftHalfEl.style.display = 'block';
          rightHalfEl.style.display = 'block';
          leftHalfEl.style.transform = `translate3d(${-sFacade * geo.W}px, 0, 0)`;
          rightHalfEl.style.transform = `translate3d(${sFacade * geo.W}px, 0, 0)`;
          const halfWin = (8.5 / 664 + sFacade - 8 / 664) * geo.W;
          const X = Math.max(0, geo.W / 2 - halfWin);
          layersEl.style.clipPath = `inset(0 ${X}px 0 ${X}px)`;
        }

        if (renderer) {
          renderer.render(geo, pan, nightAmount, offsets);
        }
      }

      bandEl.style.transform = `translate3d(0, ${bandTop * geo.H}px, 0)`;

      const springSettled = Math.abs(targetSp - sCur) < 1e-4 && vel === 0;
      const shouldKeepRunning =
        (!introDone && ready && !fallbackMode && !reducedMotion) || !springSettled;
      return shouldKeepRunning;
    };

    const tick = (now: number) => {
      rafId = 0;
      if (cancelled) return;
      const dt = Math.min(Math.max((now - lastTickTime) / 1000, 0), 0.05);
      lastTickTime = now;
      const keepGoing = renderFrame(now, dt);
      if (keepGoing && !cancelled) {
        rafId = requestAnimationFrame(tick);
      }
    };

    const kickLoop = () => {
      if (cancelled || rafId !== 0) return;
      lastTickTime = performance.now();
      rafId = requestAnimationFrame(tick);
    };

    // Draw initial frame 1 state immediately (facade blocks + ledge parked below)
    renderFrame(performance.now(), 0);

    const activateFallback = () => {
      if (cancelled || ready || fallbackMode) return;
      fallbackMode = true;
      if (reducedMotion) {
        sCur = getScrollProgress();
      }
      kickLoop();
    };

    const fallbackTimer = window.setTimeout(activateFallback, 9000);

    Promise.all([
      loadCorsImage(dayUrl),
      loadCorsImage(nightUrl),
      loadCorsImage(facadeUrl),
      loadCorsImage(bandUrl),
      document.fonts.ready.catch(() => undefined),
    ])
      .then(([dayImg, nightImg]) => {
        if (cancelled || fallbackMode) return;
        window.clearTimeout(fallbackTimer);

        // Re-measure in case layout settled while images downloaded
        const measured = measureHero();
        geo = computeHeroGeometry(measured.W, measured.H);
        applyStaticGeometry(geo);

        renderer = createStreetRenderer(layersEl, dayImg, nightImg, geo);
        ready = true;
        introStartTime = performance.now();
        if (reducedMotion) {
          sCur = getScrollProgress();
        }
        kickLoop();
      })
      .catch(() => {
        window.clearTimeout(fallbackTimer);
        activateFallback();
      });

    const handleScroll = () => {
      kickLoop();
    };

    const handleResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (cancelled) return;
        const measured = measureHero();
        geo = computeHeroGeometry(measured.W, measured.H);
        applyStaticGeometry(geo);
        if (renderer) {
          renderer.resize(geo);
        }
        kickLoop();
      }, 120);
    };

    const handleMotionChange = (e: MediaQueryListEvent) => {
      reducedMotion = e.matches;
      kickLoop();
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);
    motionQuery.addEventListener('change', handleMotionChange);

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
      window.clearTimeout(resizeTimer);
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
      }
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      motionQuery.removeEventListener('change', handleMotionChange);
      if (renderer) {
        renderer.destroy();
        renderer = null;
      }
    };
  }, []);

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
  };

  return (
    <div className="track">
      <main className="hero" ref={heroRef}>
        <div className="world" ref={worldRef} aria-hidden="true">
          <img ref={worldDayRef} alt="" crossOrigin="anonymous" />
          <img
            ref={worldNightRef}
            alt=""
            crossOrigin="anonymous"
            style={{ opacity: 0 }}
          />
        </div>

        <div id="layers" ref={layersRef} aria-hidden="true" />

        <div className="band" ref={bandRef}>
          <h1 className="title" ref={titleRef}>
            NOCHE VIVA
          </h1>
        </div>

        <div className="half l" ref={leftHalfRef} aria-hidden="true">
          <img ref={leftImgRef} alt="" crossOrigin="anonymous" />
        </div>

        <div className="half r" ref={rightHalfRef} aria-hidden="true">
          <img ref={rightImgRef} alt="" crossOrigin="anonymous" />
        </div>

        <nav className="nav" aria-label="Primary">
          <div className="nav-group">
            <a className="nav-link" href="#" onClick={handleNavClick}>
              plazas
            </a>
            <a className="nav-link" href="#" onClick={handleNavClick}>
              music
            </a>
            <a className="nav-link" href="#" onClick={handleNavClick}>
              rum
            </a>
          </div>

          <a
            className="nav-logo"
            href="#"
            aria-label="Noche Viva home"
            onClick={handleNavClick}
          >
            <svg viewBox="0 0 44 50" fill="none" aria-hidden="true">
              <path
                d="M4 50V20C4 9 12 2 22 2s18 7 18 18v30h-7V20c0-6.6-4.9-11-11-11S11 13.4 11 20v30z"
                fill="currentColor"
              />
              <circle cx="22" cy="24" r="5.5" fill="currentColor" />
              <path
                d="M16 50V36h12v14h-4.5v-9.5h-3V50z"
                fill="currentColor"
              />
            </svg>
          </a>

          <div className="nav-group">
            <a className="nav-link" href="#" onClick={handleNavClick}>
              stays
            </a>
            <a className="nav-link" href="#" onClick={handleNavClick}>
              journal
            </a>
            <a className="nav-link" href="#" onClick={handleNavClick}>
              contact
            </a>
          </div>
        </nav>
      </main>
    </div>
  );
}
