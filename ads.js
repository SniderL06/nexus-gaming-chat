/* ═══════════════════════════════════════════════════════════════
   NEXUS ADS MODULE — Google IMA SDK Video Ads
   ───────────────────────────────────────────────────────────────
   Coloca 2 banners de video autoreproducibles:
     · Banner IZQUIERDO → debajo de las salas de voz
     · Banner DERECHO   → debajo de los miembros en línea

   🔧 CUANDO TENGAS GOOGLE AD MANAGER APROBADO:
      Reemplaza TEST_VAST_TAG por tu VAST tag real de Ad Manager.
      Solo cambia esa línea y todo lo demás sigue igual.
   ═══════════════════════════════════════════════════════════════ */

// ── CONFIGURACIÓN ───────────────────────────────────────────────
const TEST_VAST_TAG =
  'https://pubads.g.doubleclick.net/gampad/ads?' +
  'iu=/21775744923/external/single_preroll_skippable&sz=640x480&' +
  'ciu_szs=300x250,728x90&gdfp_req=1&output=vast&' +
  'unviewed_position_start=1&env=vp&impl=s&correlator=';

const AD_INTERVAL_MS     = 5 * 60 * 1000; // Tiempo entre anuncios (5 min)
const SKIP_AFTER_SECONDS = 5;              // Segundos hasta que aparece el botón Skip
// ────────────────────────────────────────────────────────────────


// ── CSS DE LOS BANNERS (se inyecta automáticamente) ─────────────
const AD_CSS = `
  .nexus-ad-container {
    border-top: 1px solid rgba(255,255,255,0.06);
    background: var(--bg-tertiary, #0f1012);
    padding: 8px;
  }
  .nexus-ad-label {
    font-size: 9px;
    letter-spacing: 1.5px;
    color: var(--text-muted, #555);
    text-transform: uppercase;
    margin-bottom: 5px;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .nexus-ad-label::before {
    content: '';
    width: 12px;
    height: 1px;
    background: currentColor;
  }
  .nexus-ad-wrapper {
    position: relative;
    width: 100%;
    background: #000;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid rgba(124, 92, 252, 0.25);
    min-height: 90px;
  }
  .nexus-ad-wrapper.ad-playing {
    border-color: rgba(124, 92, 252, 0.6);
    box-shadow: 0 0 12px rgba(124, 92, 252, 0.25);
  }
  .nexus-ad-wrapper video {
    width: 100%;
    display: block;
  }
  .nexus-ad-overlay {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    pointer-events: none;
    z-index: 10;
  }
  .nexus-ad-overlay.active { pointer-events: all; }
  .nexus-ad-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 90px;
    gap: 7px;
    color: var(--text-muted, #555);
    font-size: 10px;
    font-family: inherit;
  }
  .nexus-ad-spinner {
    width: 18px; height: 18px;
    border: 2px solid rgba(124,92,252,0.15);
    border-top-color: var(--accent-purple, #8b5cf6);
    border-radius: 50%;
    animation: nexusAdSpin 0.8s linear infinite;
  }
  @keyframes nexusAdSpin { to { transform: rotate(360deg); } }
  .nexus-ad-countdown {
    position: absolute;
    bottom: 6px; right: 6px;
    background: rgba(0,0,0,0.75);
    color: #fff;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
    z-index: 20;
    font-family: monospace;
    display: none;
  }
  .nexus-ad-skip {
    position: absolute;
    bottom: 6px; right: 6px;
    background: rgba(0,0,0,0.82);
    color: #fff;
    font-size: 10px;
    padding: 4px 9px;
    border-radius: 3px;
    z-index: 20;
    cursor: pointer;
    border: 1px solid rgba(255,255,255,0.2);
    display: none;
    font-family: inherit;
    transition: background 0.15s;
  }
  .nexus-ad-skip:hover { background: var(--accent-purple, #8b5cf6); }
  .nexus-ad-mute {
    position: absolute;
    top: 6px; right: 6px;
    background: rgba(0,0,0,0.7);
    color: #fff;
    font-size: 12px;
    width: 22px; height: 22px;
    border-radius: 50%;
    z-index: 20;
    cursor: pointer;
    border: none;
    display: none;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }
  .nexus-ad-status {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 4px;
    font-size: 9px;
    color: var(--text-muted, #555);
    font-family: inherit;
  }
  .nexus-ad-dot {
    width: 5px; height: 5px;
    border-radius: 50%;
    background: #444;
    flex-shrink: 0;
  }
  .nexus-ad-dot.live {
    background: var(--accent-green, #4ade80);
    box-shadow: 0 0 5px var(--accent-green, #4ade80);
    animation: nexusAdBlink 1.5s ease-in-out infinite;
  }
  @keyframes nexusAdBlink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.25; }
  }
`;

// ── Inyectar CSS una sola vez ────────────────────────────────────
function injectAdStyles() {
  if (document.getElementById('nexus-ad-styles')) return;
  const style = document.createElement('style');
  style.id = 'nexus-ad-styles';
  style.textContent = AD_CSS;
  document.head.appendChild(style);
}

// ── Crear el HTML del banner ─────────────────────────────────────
function createAdBannerHTML(uid) {
  return `
    <div class="nexus-ad-container" id="nexus-ad-container-${uid}">
      <div class="nexus-ad-label">Publicidad</div>
      <div class="nexus-ad-wrapper" id="nexus-ad-wrapper-${uid}">
        <div class="nexus-ad-loading" id="nexus-ad-loading-${uid}">
          <div class="nexus-ad-spinner"></div>
          <span>Cargando anuncio...</span>
        </div>
        <video id="nexus-ad-video-${uid}" playsinline muted style="display:none"></video>
        <div class="nexus-ad-overlay" id="nexus-ad-overlay-${uid}"></div>
        <div class="nexus-ad-countdown" id="nexus-ad-countdown-${uid}"></div>
        <button class="nexus-ad-skip" id="nexus-ad-skip-${uid}">Saltar ›</button>
        <button class="nexus-ad-mute" id="nexus-ad-mute-${uid}" title="Silenciar">🔇</button>
      </div>
      <div class="nexus-ad-status">
        <div class="nexus-ad-dot" id="nexus-ad-dot-${uid}"></div>
        <span id="nexus-ad-status-text-${uid}">Iniciando...</span>
      </div>
    </div>
  `;
}

// ── Clase principal del player ───────────────────────────────────
class NexusAdPlayer {
  constructor(uid, vastTag) {
    this.uid         = uid;
    this.vastTag     = vastTag;
    this.videoEl     = document.getElementById(`nexus-ad-video-${uid}`);
    this.overlayEl   = document.getElementById(`nexus-ad-overlay-${uid}`);
    this.wrapperEl   = document.getElementById(`nexus-ad-wrapper-${uid}`);
    this.loadingEl   = document.getElementById(`nexus-ad-loading-${uid}`);
    this.countdownEl = document.getElementById(`nexus-ad-countdown-${uid}`);
    this.skipBtn     = document.getElementById(`nexus-ad-skip-${uid}`);
    this.muteBtn     = document.getElementById(`nexus-ad-mute-${uid}`);
    this.dotEl       = document.getElementById(`nexus-ad-dot-${uid}`);
    this.statusEl    = document.getElementById(`nexus-ad-status-text-${uid}`);

    this.adsLoader          = null;
    this.adsManager         = null;
    this.adDisplayContainer = null;
    this.countdownTimer     = null;
    this.isMuted            = true;
    this.started            = false;

    this._bindUI();
  }

  _setStatus(text, live = false) {
    if (this.statusEl) this.statusEl.textContent = text;
    if (this.dotEl) this.dotEl.className = 'nexus-ad-dot' + (live ? ' live' : '');
  }

  _bindUI() {
    this.skipBtn?.addEventListener('click', () => this.adsManager?.skip());
    this.muteBtn?.addEventListener('click', () => {
      this.isMuted = !this.isMuted;
      this.adsManager?.setVolume(this.isMuted ? 0 : 0.8);
      if (this.muteBtn) this.muteBtn.textContent = this.isMuted ? '🔇' : '🔊';
    });
  }

  init() {
    if (this.started) return;
    this.started = true;

    if (typeof google === 'undefined' || !google.ima) {
      this._setStatus('SDK no disponible');
      this._showEmpty('IMA SDK no cargó');
      return;
    }

    try {
      google.ima.settings.setDisableCustomPlaybackForIOS10Plus(true);
      this.adDisplayContainer = new google.ima.AdDisplayContainer(
        this.overlayEl, this.videoEl
      );
      this.adsLoader = new google.ima.AdsLoader(this.adDisplayContainer);

      this.adsLoader.addEventListener(
        google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
        (e) => this._onLoaded(e)
      );
      this.adsLoader.addEventListener(
        google.ima.AdErrorEvent.Type.AD_ERROR,
        (e) => this._onError(e)
      );

      this._request();
    } catch (err) {
      console.warn(`[NexusAds:${this.uid}] Init error:`, err);
      this._showEmpty('Error de inicialización');
    }
  }

  _request() {
    this._setStatus('Cargando anuncio...');
    if (this.loadingEl) {
      this.loadingEl.style.display = 'flex';
      this.loadingEl.innerHTML = '<div class="nexus-ad-spinner"></div><span>Cargando anuncio...</span>';
    }
    if (this.videoEl) this.videoEl.style.display = 'none';

    const req = new google.ima.AdsRequest();
    req.adTagUrl = this.vastTag + Math.floor(Math.random() * 1e9);
    req.linearAdSlotWidth   = this.wrapperEl?.offsetWidth  || 180;
    req.linearAdSlotHeight  = this.wrapperEl?.offsetHeight || 100;
    req.nonLinearAdSlotWidth  = this.wrapperEl?.offsetWidth  || 180;
    req.nonLinearAdSlotHeight = 80;

    this.adDisplayContainer.initialize();
    this.adsLoader.requestAds(req);
  }

  _onLoaded(e) {
    const settings = new google.ima.AdsRenderingSettings();
    settings.restoreCustomPlaybackStateOnAdBreakComplete = true;

    this.adsManager = e.getAdsManager(this.videoEl, settings);

    this.adsManager.addEventListener(google.ima.AdEvent.Type.STARTED,          () => this._onStarted());
    this.adsManager.addEventListener(google.ima.AdEvent.Type.COMPLETE,         () => this._onDone());
    this.adsManager.addEventListener(google.ima.AdEvent.Type.SKIPPED,          () => this._onDone());
    this.adsManager.addEventListener(google.ima.AdEvent.Type.ALL_ADS_COMPLETED,() => this._scheduleNext());
    this.adsManager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR,    (e) => this._onError(e));

    try {
      this.adsManager.init(
        this.wrapperEl?.offsetWidth  || 180,
        this.wrapperEl?.offsetHeight || 100,
        google.ima.ViewMode.NORMAL
      );
      this.adsManager.start();
    } catch (err) {
      this._onError(err);
    }
  }

  _onStarted() {
    if (this.loadingEl) this.loadingEl.style.display = 'none';
    if (this.videoEl)   this.videoEl.style.display   = 'block';
    if (this.overlayEl) this.overlayEl.classList.add('active');
    if (this.wrapperEl) this.wrapperEl.classList.add('ad-playing');
    if (this.muteBtn)   this.muteBtn.style.display   = 'flex';
    this._setStatus('Reproduciendo', true);
    this._startCountdown();
  }

  _startCountdown() {
    clearInterval(this.countdownTimer);
    let secs = 30;
    let skipShown = false;

    if (this.countdownEl) {
      this.countdownEl.style.display = 'block';
      this.countdownEl.textContent   = `${secs}s`;
    }

    this.countdownTimer = setInterval(() => {
      secs--;
      if (secs <= 0) {
        clearInterval(this.countdownTimer);
        if (this.countdownEl) this.countdownEl.style.display = 'none';
        return;
      }
      if (this.countdownEl) this.countdownEl.textContent = `${secs}s`;

      if (!skipShown && secs <= (30 - SKIP_AFTER_SECONDS)) {
        skipShown = true;
        if (this.skipBtn)     this.skipBtn.style.display     = 'block';
        if (this.countdownEl) this.countdownEl.style.display = 'none';
      }
    }, 1000);
  }

  _onDone() {
    clearInterval(this.countdownTimer);
    if (this.wrapperEl)  this.wrapperEl.classList.remove('ad-playing');
    if (this.overlayEl)  this.overlayEl.classList.remove('active');
    if (this.countdownEl)this.countdownEl.style.display = 'none';
    if (this.skipBtn)    this.skipBtn.style.display     = 'none';
    if (this.muteBtn)    this.muteBtn.style.display     = 'none';
    if (this.videoEl)    this.videoEl.style.display     = 'none';
    if (this.loadingEl) {
      this.loadingEl.style.display = 'flex';
      this.loadingEl.innerHTML = '<div class="nexus-ad-spinner"></div><span>Cargando siguiente...</span>';
    }
    this._setStatus('Completado ✓');
  }

  _scheduleNext() {
    const mins = Math.round(AD_INTERVAL_MS / 60000);
    this._setStatus(`Próximo en ${mins} min`);
    setTimeout(() => {
      if (this.adsLoader) {
        this.adsLoader.contentComplete();
        this._request();
      }
    }, AD_INTERVAL_MS);
  }

  _onError(e) {
    const msg = e?.getError?.()?.getMessage?.() || String(e);
    console.warn(`[NexusAds:${this.uid}] Error:`, msg);
    this._setStatus('Sin anuncio disponible');
    this._showEmpty('Sin anuncio<br>disponible');
    // Reintentar en 2 minutos
    setTimeout(() => {
      if (this.started && this.adsLoader) {
        this._request();
      }
    }, 2 * 60 * 1000);
  }

  _showEmpty(html) {
    if (this.loadingEl) {
      this.loadingEl.style.display = 'flex';
      this.loadingEl.innerHTML = `<span style="font-size:10px;color:var(--text-muted,#555);text-align:center;line-height:1.4;">${html}</span>`;
    }
  }
}


// ── FUNCIÓN PRINCIPAL: Insertar banners e iniciar players ────────
function initNexusAds() {
  injectAdStyles();

  // ── Banner IZQUIERDO: justo antes del .user-panel ──────────────
  const userPanel = document.querySelector('.sidebar-left .user-panel');
  if (userPanel) {
    const leftDiv = document.createElement('div');
    leftDiv.innerHTML = createAdBannerHTML('left');
    userPanel.parentNode.insertBefore(leftDiv.firstElementChild, userPanel);
  } else {
    console.warn('[NexusAds] No se encontró .user-panel en sidebar-left');
  }

  // ── Banner DERECHO: al final de .members-panel ─────────────────
  const membersPanel = document.querySelector('.sidebar-right .members-panel');
  if (membersPanel) {
    const rightDiv = document.createElement('div');
    rightDiv.innerHTML = createAdBannerHTML('right');
    membersPanel.parentNode.appendChild(rightDiv.firstElementChild);
  } else {
    console.warn('[NexusAds] No se encontró .members-panel en sidebar-right');
  }

  // ── Crear los players ──────────────────────────────────────────
  const playerLeft  = new NexusAdPlayer('left',  TEST_VAST_TAG);
  // El player derecho arranca 3 segundos después para no saturar al mismo tiempo
  const playerRight = new NexusAdPlayer('right', TEST_VAST_TAG);

  // ── Los navegadores modernos requieren interacción del usuario
  //    para autoplay con audio. Iniciamos en el primer clic. ──────
  function startPlayers() {
    playerLeft.init();
    setTimeout(() => playerRight.init(), 3000);
  }

  // Intentar iniciar automáticamente (funciona si ya hubo interacción previa)
  if (document.readyState === 'complete') {
    startPlayers();
  } else {
    window.addEventListener('load', startPlayers, { once: true });
  }

  // Fallback: iniciar en el primer clic del usuario si no arrancó solo
  document.addEventListener('click', () => {
    if (!playerLeft.started)  playerLeft.init();
    if (!playerRight.started) setTimeout(() => playerRight.init(), 3000);
  }, { once: true });
}


// ── Esperar a que el IMA SDK esté disponible ─────────────────────
function waitForIMA(callback, tries = 0) {
  if (typeof google !== 'undefined' && google.ima) {
    callback();
  } else if (tries < 20) {
    setTimeout(() => waitForIMA(callback, tries + 1), 300);
  } else {
    console.warn('[NexusAds] IMA SDK no disponible tras 6 segundos. Verifica la conexión.');
  }
}

// ── Punto de entrada ─────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => waitForIMA(initNexusAds));
} else {
  waitForIMA(initNexusAds);
}
