const socket = io();
const LOCAL_ROOM_ID = "local";
const QUALITY_STORAGE_KEY = "babycam-quality";
const HOST_VIDEO_FX_STORAGE_KEY = "babycam-host-video-fx";
const HOST_VIDEO_FX_DEFAULTS = Object.freeze({
  brightness: 100,
  contrast: 100,
  zoom: 100,
  infrared: false
});

const els = {
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
  eventText: document.getElementById("eventText"),
  modeLocal: document.getElementById("modeLocal"),
  modeSecure: document.getElementById("modeSecure"),
  roomWrap: document.getElementById("roomWrap"),
  roomInput: document.getElementById("roomInput"),
  regenRoomBtn: document.getElementById("regenRoomBtn"),
  secureKeyWrap: document.getElementById("secureKeyWrap"),
  accessKeyInput: document.getElementById("accessKeyInput"),
  regenKeyBtn: document.getElementById("regenKeyBtn"),
  modeHint: document.getElementById("modeHint"),
  cameraSelect: document.getElementById("cameraSelect"),
  micSelect: document.getElementById("micSelect"),
  qualitySelect: document.getElementById("qualitySelect"),
  refreshDevicesBtn: document.getElementById("refreshDevicesBtn"),
  applyDevicesBtn: document.getElementById("applyDevicesBtn"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  previewVideo: document.getElementById("previewVideo"),
  hostBrightnessRange: document.getElementById("hostBrightnessRange"),
  hostBrightnessValue: document.getElementById("hostBrightnessValue"),
  hostContrastRange: document.getElementById("hostContrastRange"),
  hostContrastValue: document.getElementById("hostContrastValue"),
  hostZoomRange: document.getElementById("hostZoomRange"),
  hostZoomValue: document.getElementById("hostZoomValue"),
  hostInfraToggle: document.getElementById("hostInfraToggle"),
  hostFxToggleBtn: document.getElementById("hostFxToggleBtn"),
  hostFxPanel: document.getElementById("hostFxPanel"),
  hostFxResetBtn: document.getElementById("hostFxResetBtn"),
  shareUrlSelect: document.getElementById("shareUrlSelect"),
  copyBtn: document.getElementById("copyBtn"),
  shareBtn: document.getElementById("shareBtn"),
  viewerAnchor: document.getElementById("viewerAnchor"),
  viewerCount: document.getElementById("viewerCount"),
  qrModal: document.getElementById("qrModal"),
  qrUrlSelect: document.getElementById("qrUrlSelect"),
  qrModalImg: document.getElementById("qrModalImg"),
  qrModalLink: document.getElementById("qrModalLink"),
  qrModalUrl: document.getElementById("qrModalUrl"),
  qrModalCloseBtn: document.getElementById("qrModalCloseBtn")
};

const state = {
  config: {
    publicBaseUrl: "",
    iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
    localWatchUrls: []
  },
  streamMode: "local",
  qualityPreset: loadQualityPreset(),
  activeRoomId: "",
  accessKey: "",
  isStreaming: false,
  isRegistered: false,
  sourceStream: null,
  localStream: null,
  videoFxRunner: null,
  isHostFxOpen: false,
  videoFx: loadHostVideoFx(),
  selectedShareUrl: "",
  peers: new Map(),
  waitingViewers: new Set()
};
let registerTimer = null;

init().catch((error) => {
  setStatus("Error de inicializacion", "err");
  setEvent(error.message || "No se pudo cargar la pagina");
});

async function init() {
  setStatus("Standby", "warn");
  bindUi();
  bindSocket();

  if (!window.isSecureContext) {
    setEvent("Contexto no seguro: usa https o localhost para habilitar camara/microfono.");
  }

  await loadConfig();
  state.activeRoomId = getRoomFromUrl() || generateRoomId();
  state.accessKey = getAccessKeyFromUrl() || generateAccessKey();
  syncSecureInputs();
  syncQualityInput();
  syncHostFxInputs();
  syncHostFxUi();
  updateModeUi();
  updateShareArtifacts();
  const registered = await ensureHostRegistration({ silent: true });
  if (registered) {
    setStatus("Standby remoto", "ok");
    if (window.isSecureContext) {
      setEvent("Host listo. Puedes iniciar desde este panel o desde el viewer.");
    }
  }
  await refreshDevices(false);
}

function bindUi() {
  els.modeLocal.addEventListener("change", onModeChange);
  els.modeSecure.addEventListener("change", onModeChange);

  els.regenRoomBtn.addEventListener("click", () => {
    if (state.isStreaming) {
      setEvent("Detene la transmision para cambiar la sala.");
      return;
    }
    state.activeRoomId = generateRoomId();
    els.roomInput.value = state.activeRoomId;
    updateShareArtifacts();
    scheduleHostRegistration();
  });

  els.regenKeyBtn.addEventListener("click", () => {
    if (state.isStreaming) {
      setEvent("Detene la transmision para cambiar la clave.");
      return;
    }
    state.accessKey = generateAccessKey();
    els.accessKeyInput.value = state.accessKey;
    updateShareArtifacts();
    scheduleHostRegistration();
  });

  els.roomInput.addEventListener("input", () => {
    const roomId = sanitizeRoomId(els.roomInput.value);
    els.roomInput.value = roomId;
    state.activeRoomId = roomId || state.activeRoomId;
    updateShareArtifacts();
    scheduleHostRegistration();
  });

  els.accessKeyInput.addEventListener("input", () => {
    const key = sanitizeAccessKey(els.accessKeyInput.value);
    els.accessKeyInput.value = key;
    state.accessKey = key;
    updateShareArtifacts();
    scheduleHostRegistration();
  });

  els.qualitySelect.addEventListener("change", async () => {
    state.qualityPreset = sanitizeQualityPreset(els.qualitySelect.value);
    syncQualityInput();
    persistQualityPreset();

    if (!state.isStreaming) {
      setEvent("Calidad guardada. Se aplicara cuando inicies transmision.");
      return;
    }

    try {
      await startOrReplaceStream();
      setEvent(`Calidad aplicada en vivo: ${describeQualityLabel(state.qualityPreset)}.`);
    } catch {
      /* no-op: mensaje ya mostrado */
    }
  });

  els.refreshDevicesBtn.addEventListener("click", async () => {
    try {
      await refreshDevices(true);
    } catch {
      /* no-op: mensaje ya mostrado */
    }
  });

  els.applyDevicesBtn.addEventListener("click", async () => {
    if (!state.isStreaming) {
      setEvent("Aplicacion lista. Inicia la transmision para tomar audio/video.");
      return;
    }
    try {
      await startOrReplaceStream();
      setEvent("Dispositivos aplicados.");
    } catch {
      /* no-op: mensaje ya mostrado */
    }
  });
  els.hostBrightnessRange.addEventListener("input", () => {
    updateHostVideoFx("brightness", els.hostBrightnessRange.value);
  });
  els.hostContrastRange.addEventListener("input", () => {
    updateHostVideoFx("contrast", els.hostContrastRange.value);
  });
  els.hostZoomRange.addEventListener("input", () => {
    updateHostVideoFx("zoom", els.hostZoomRange.value);
  });
  els.hostInfraToggle.addEventListener("change", () => {
    updateHostVideoFx("infrared", els.hostInfraToggle.checked);
  });
  els.hostFxResetBtn.addEventListener("click", resetHostVideoFx);
  els.hostFxToggleBtn.addEventListener("click", toggleHostFxPanel);
  els.shareUrlSelect.addEventListener("change", () => {
    state.selectedShareUrl = els.shareUrlSelect.value || getShareUrl();
    syncViewerAnchor();
    if (!els.qrModal.classList.contains("hidden")) {
      syncQrUrlOptions(state.selectedShareUrl);
      updateQrModalArtifacts(state.selectedShareUrl);
    }
  });

  els.startBtn.addEventListener("click", startHosting);
  els.stopBtn.addEventListener("click", stopHosting);
  els.copyBtn.addEventListener("click", () => openQrModal());
  els.shareBtn.addEventListener("click", nativeShare);
  els.qrModalCloseBtn.addEventListener("click", closeQrModal);
  els.qrUrlSelect.addEventListener("change", () => {
    updateQrModalArtifacts(els.qrUrlSelect.value);
  });
  els.qrModal.addEventListener("click", (event) => {
    if (event.target === els.qrModal) {
      closeQrModal();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.isHostFxOpen) {
      toggleHostFxPanel(false);
    }
    if (event.key === "Escape" && !els.qrModal.classList.contains("hidden")) {
      closeQrModal();
    }
  });

  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", async () => {
      await refreshDevices(false);
    });
  }
}

function bindSocket() {
  socket.on("connect", () => {
    reconnectAsHost().catch(() => {
      setStatus("Reconectar host fallo", "err");
    });
  });

  socket.on("disconnect", () => {
    state.isRegistered = false;
    setStatus("Servidor desconectado", "err");
    for (const viewerId of state.peers.keys()) {
      closePeer(viewerId);
    }
    state.peers.clear();
    state.waitingViewers.clear();
    updateViewerCount();
  });

  socket.on("viewer:joined", async ({ viewerId }) => {
    if (!viewerId) {
      return;
    }
    state.waitingViewers.add(viewerId);
    if (!state.isStreaming || !state.localStream || state.peers.has(viewerId)) {
      updateViewerCount();
      return;
    }
    try {
      await createOfferForViewer(viewerId);
      setEvent(`Viewer conectado (${state.waitingViewers.size}).`);
    } catch {
      closePeer(viewerId);
      setEvent("No se pudo conectar un viewer nuevo.");
    }
    updateViewerCount();
  });

  socket.on("viewer:left", ({ viewerId }) => {
    if (viewerId) {
      state.waitingViewers.delete(viewerId);
      closePeer(viewerId);
      updateViewerCount();
    }
  });

  socket.on("signal:answer", async ({ from, description }) => {
    const pc = state.peers.get(from);
    if (!pc || !description) {
      return;
    }
    await pc.setRemoteDescription(description);
  });

  socket.on("signal:candidate", async ({ from, candidate }) => {
    const pc = state.peers.get(from);
    if (!pc || !candidate) {
      return;
    }
    try {
      await pc.addIceCandidate(candidate);
    } catch {
      setEvent("No se pudo aplicar candidato ICE.");
    }
  });

  socket.on("control:stream", async ({ action, requesterId } = {}, reply = () => {}) => {
    const requester = shortSocketId(requesterId);

    if (action === "start") {
      setEvent(`Solicitud remota: iniciar (${requester}).`);
      const started = await startHosting();
      reply(started ? { ok: true, message: "started" } : { ok: false, error: "start_failed" });
      return;
    }

    if (action === "stop") {
      setEvent(`Solicitud remota: detener (${requester}).`);
      const stopped = await stopHosting();
      reply(stopped ? { ok: true, message: "stopped" } : { ok: false, error: "stop_failed" });
      return;
    }

    reply({ ok: false, error: "invalid_action" });
  });
}

async function onModeChange() {
  const nextMode = els.modeSecure.checked ? "secure" : "local";
  if (state.isStreaming && nextMode !== state.streamMode) {
    setEvent("Detene la transmision para cambiar entre Local e Internet seguro.");
    syncModeInputs();
    return;
  }
  state.streamMode = nextMode;
  updateModeUi();
  updateShareArtifacts();
  if (!state.isStreaming) {
    await ensureHostRegistration({ silent: true });
  }
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    if (data?.publicBaseUrl) {
      state.config.publicBaseUrl = data.publicBaseUrl;
    }
    if (Array.isArray(data?.iceServers) && data.iceServers.length > 0) {
      state.config.iceServers = data.iceServers;
    }
    if (Array.isArray(data?.localWatchUrls)) {
      state.config.localWatchUrls = data.localWatchUrls.filter((url) => typeof url === "string");
    }
  } catch {
    setEvent("No se pudo cargar config remota. Uso defaults.");
  }
}

async function refreshDevices(requestPermissions) {
  if (!navigator.mediaDevices?.enumerateDevices) {
    setEvent("Este navegador no soporta enumerateDevices.");
    return;
  }

  if (requestPermissions) {
    await requestMediaPermissions();
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === "videoinput");
  const mics = devices.filter((device) => device.kind === "audioinput");

  fillSelect(els.cameraSelect, cameras, "Sin camaras detectadas", "Camara");
  fillSelect(els.micSelect, mics, "Sin microfonos detectados", "Microfono");
}

async function requestMediaPermissions() {
  try {
    const tmpStream = await tryGetUserMedia({ video: true, audio: true });
    stopStream(tmpStream);
  } catch (error) {
    try {
      const tmpVideoOnly = await tryGetUserMedia({ video: true, audio: false });
      stopStream(tmpVideoOnly);
      setEvent("Permiso de microfono no disponible. Video habilitado.");
    } catch (videoError) {
      setEvent("Permisos de camara bloqueados.");
      throw videoError;
    }
  }
}

function fillSelect(select, devices, emptyLabel, fallbackLabel) {
  const currentValue = select.value;
  select.innerHTML = "";

  if (devices.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = emptyLabel;
    select.append(option);
    return;
  }

  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `${fallbackLabel} ${index + 1}`;
    select.append(option);
  });

  const canRestore = devices.some((device) => device.deviceId === currentValue);
  if (canRestore) {
    select.value = currentValue;
  }
}

async function startHosting() {
  try {
    if (!socket.connected) {
      setEvent("Servidor desconectado. Reintenta en unos segundos.");
      return false;
    }
    if (state.isStreaming && state.localStream) {
      setStatus("Transmitiendo", "ok");
      setEvent("La transmision ya estaba activa.");
      return true;
    }

    const payload = getJoinPayload();
    if (!payload) {
      return false;
    }

    const registered = await ensureHostRegistration({ payload });
    if (!registered) {
      setStatus("No se pudo iniciar", "err");
      return false;
    }

    await startOrReplaceStream();
    state.isStreaming = true;
    for (const viewerId of state.waitingViewers) {
      if (state.peers.has(viewerId)) {
        continue;
      }
      await createOfferForViewer(viewerId);
    }

    setStatus("Transmitiendo", "ok");
    setEvent(`En vivo en ${getShareUrl()} | Calidad: ${describeQualityLabel(state.qualityPreset)}.`);
    els.startBtn.disabled = true;
    els.stopBtn.disabled = false;
    updateViewerCount();
    return true;
  } catch (error) {
    setStatus("No se pudo iniciar", "err");
    setEvent(describeMediaError(error));
    return false;
  }
}

async function stopHosting() {
  if (!state.isStreaming && !state.localStream && !state.sourceStream) {
    return true;
  }

  state.isStreaming = false;

  for (const viewerId of state.peers.keys()) {
    closePeer(viewerId);
  }
  state.peers.clear();
  updateViewerCount();

  if (state.localStream) {
    stopStream(state.localStream);
    state.localStream = null;
  }
  if (state.sourceStream) {
    stopStream(state.sourceStream);
    state.sourceStream = null;
  }
  stopVideoFxRunner();
  els.previewVideo.srcObject = null;
  els.startBtn.disabled = false;
  els.stopBtn.disabled = true;
  setStatus(state.isRegistered ? "Standby remoto" : "Standby", state.isRegistered ? "ok" : "warn");
  setEvent("Transmision detenida. El viewer puede volver a iniciarla.");
  return true;
}

async function startOrReplaceStream() {
  const cameraId = els.cameraSelect.value;
  const micId = els.micSelect.value;

  if (!cameraId) {
    setEvent("Necesitas al menos una camara activa.");
    throw new Error("Missing video device");
  }

  let freshSourceStream = null;
  let freshOutputStream = null;
  let freshRunner = null;

  try {
    freshSourceStream = await acquireBestEffortStream(cameraId, micId, state.qualityPreset);
    const processed = await buildProcessedStream(freshSourceStream, state.qualityPreset);
    freshOutputStream = processed.outputStream;
    freshRunner = processed.runner;

    els.previewVideo.srcObject = freshOutputStream;
    await els.previewVideo.play().catch(() => {});
  } catch (error) {
    if (freshOutputStream) {
      stopStream(freshOutputStream);
    }
    if (freshSourceStream) {
      stopStream(freshSourceStream);
    }
    if (freshRunner) {
      cleanupVideoFxRunner(freshRunner);
    }
    throw error;
  }

  if (state.localStream) {
    await replaceTracksOnPeers(freshOutputStream);
    stopStream(state.localStream);
  }
  if (state.sourceStream) {
    stopStream(state.sourceStream);
  }
  stopVideoFxRunner();

  state.videoFxRunner = freshRunner;
  state.sourceStream = freshSourceStream;
  state.localStream = freshOutputStream;
}

async function buildProcessedStream(sourceStream, qualityPreset) {
  const sourceVideoTrack = sourceStream.getVideoTracks()[0];
  if (!sourceVideoTrack) {
    throw new Error("Missing video track");
  }

  const quality = sanitizeQualityPreset(qualityPreset);
  const profile = getQualityProfile(quality);
  const settings = sourceVideoTrack.getSettings ? sourceVideoTrack.getSettings() : {};
  const width = normalizePositiveInt(settings.width, profile.width);
  const height = normalizePositiveInt(settings.height, profile.height);
  const fps = clampInt(settings.frameRate, 12, 60, profile.fps);
  const runner = createVideoFxRunner(sourceVideoTrack, width, height, fps);

  try {
    await runner.videoEl.play().catch(() => {});
    runner.frameId = requestAnimationFrame(runner.render);
    const processedVideoTrack = runner.canvasStream.getVideoTracks()[0];
    if (!processedVideoTrack) {
      throw new Error("No processed video track");
    }

    const outputStream = new MediaStream();
    outputStream.addTrack(processedVideoTrack);
    for (const audioTrack of sourceStream.getAudioTracks()) {
      outputStream.addTrack(audioTrack);
    }
    return { outputStream, runner };
  } catch (error) {
    cleanupVideoFxRunner(runner);
    throw error;
  }
}

function createVideoFxRunner(sourceVideoTrack, width, height, fps) {
  const videoEl = document.createElement("video");
  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.autoplay = true;
  videoEl.srcObject = new MediaStream([sourceVideoTrack]);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    throw new Error("Canvas 2D no disponible");
  }

  const canvasStream = canvas.captureStream(fps);
  const runner = {
    videoEl,
    canvas,
    ctx,
    canvasStream,
    frameId: 0,
    stopped: false,
    render: null
  };

  runner.render = () => {
    if (runner.stopped) {
      return;
    }
    drawVideoFxFrame(runner);
    runner.frameId = requestAnimationFrame(runner.render);
  };

  return runner;
}

function drawVideoFxFrame(runner) {
  if (runner.videoEl.readyState < 2) {
    return;
  }

  const sourceWidth = normalizePositiveInt(runner.videoEl.videoWidth, runner.canvas.width);
  const sourceHeight = normalizePositiveInt(runner.videoEl.videoHeight, runner.canvas.height);
  if (sourceWidth !== runner.canvas.width || sourceHeight !== runner.canvas.height) {
    runner.canvas.width = sourceWidth;
    runner.canvas.height = sourceHeight;
  }

  const width = runner.canvas.width;
  const height = runner.canvas.height;
  const fx = getEffectiveHostVideoFx();
  const zoom = fx.zoom / 100;
  const sourceCropWidth = width / zoom;
  const sourceCropHeight = height / zoom;
  const sourceX = (width - sourceCropWidth) / 2;
  const sourceY = (height - sourceCropHeight) / 2;

  runner.ctx.save();
  runner.ctx.clearRect(0, 0, width, height);
  runner.ctx.filter = buildVideoFxFilter(fx);
  runner.ctx.drawImage(
    runner.videoEl,
    sourceX,
    sourceY,
    sourceCropWidth,
    sourceCropHeight,
    0,
    0,
    width,
    height
  );
  runner.ctx.restore();
}

function buildVideoFxFilter(fx) {
  const brightness = (fx.brightness / 100) * (fx.infrared ? 1.12 : 1);
  const contrast = (fx.contrast / 100) * (fx.infrared ? 1.25 : 1);
  return [
    `grayscale(${fx.infrared ? 1 : 0})`,
    `brightness(${brightness.toFixed(2)})`,
    `contrast(${contrast.toFixed(2)})`,
    `saturate(${fx.infrared ? 0.12 : 1})`
  ].join(" ");
}

function getEffectiveHostVideoFx() {
  return {
    brightness: clampInt(state.videoFx.brightness, 60, 220, HOST_VIDEO_FX_DEFAULTS.brightness),
    contrast: clampInt(state.videoFx.contrast, 60, 220, HOST_VIDEO_FX_DEFAULTS.contrast),
    zoom: clampInt(state.videoFx.zoom, 100, 300, HOST_VIDEO_FX_DEFAULTS.zoom),
    infrared: Boolean(state.videoFx.infrared)
  };
}

function stopVideoFxRunner() {
  if (!state.videoFxRunner) {
    return;
  }
  cleanupVideoFxRunner(state.videoFxRunner);
  state.videoFxRunner = null;
}

function cleanupVideoFxRunner(runner) {
  runner.stopped = true;
  if (runner.frameId) {
    cancelAnimationFrame(runner.frameId);
  }
  if (runner.videoEl) {
    runner.videoEl.pause();
    runner.videoEl.srcObject = null;
  }
  if (runner.canvasStream) {
    stopStream(runner.canvasStream);
  }
}

async function replaceTracksOnPeers(freshStream) {
  const freshTracksByKind = new Map();
  for (const track of freshStream.getTracks()) {
    freshTracksByKind.set(track.kind, track);
  }

  for (const [, pc] of state.peers) {
    for (const sender of pc.getSenders()) {
      const kind = sender.track?.kind;
      if (!kind) {
        continue;
      }
      const replacement = freshTracksByKind.get(kind) || null;
      await sender.replaceTrack(replacement);
    }
  }
}

async function createOfferForViewer(viewerId) {
  const pc = createPeer(viewerId);
  if (!state.localStream) {
    return;
  }

  for (const track of state.localStream.getTracks()) {
    pc.addTrack(track, state.localStream);
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("signal:offer", {
    to: viewerId,
    description: pc.localDescription
  });
}

function createPeer(viewerId) {
  if (state.peers.has(viewerId)) {
    return state.peers.get(viewerId);
  }

  const pc = new RTCPeerConnection({
    iceServers: state.config.iceServers
  });

  pc.onicecandidate = (event) => {
    if (!event.candidate) {
      return;
    }
    socket.emit("signal:candidate", {
      to: viewerId,
      candidate: event.candidate
    });
  };

  pc.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
      closePeer(viewerId);
      updateViewerCount();
    }
  };

  state.peers.set(viewerId, pc);
  return pc;
}

function closePeer(viewerId) {
  const pc = state.peers.get(viewerId);
  if (pc) {
    pc.close();
  }
  state.peers.delete(viewerId);
}

function updateViewerCount() {
  els.viewerCount.textContent = String(state.waitingViewers.size);
}

function updateModeUi() {
  const secure = state.streamMode === "secure";
  els.roomWrap.classList.toggle("hidden", !secure);
  els.secureKeyWrap.classList.toggle("hidden", !secure);
  els.modeHint.textContent = secure
    ? "Internet seguro: usa sala + clave de acceso en el link."
    : "Local simple: abrilo en el celular con la IP de esta PC y /watch.";
  syncModeInputs();
}

function syncModeInputs() {
  els.modeLocal.checked = state.streamMode === "local";
  els.modeSecure.checked = state.streamMode === "secure";
}

function syncSecureInputs() {
  els.roomInput.value = state.activeRoomId;
  els.accessKeyInput.value = state.accessKey;
}

function syncQualityInput() {
  const normalized = sanitizeQualityPreset(state.qualityPreset);
  state.qualityPreset = normalized;
  if (els.qualitySelect.value !== normalized) {
    els.qualitySelect.value = normalized;
  }
}

function syncHostFxInputs() {
  els.hostBrightnessRange.value = String(state.videoFx.brightness);
  els.hostContrastRange.value = String(state.videoFx.contrast);
  els.hostZoomRange.value = String(state.videoFx.zoom);
  els.hostInfraToggle.checked = state.videoFx.infrared;

  els.hostBrightnessValue.textContent = `${state.videoFx.brightness}%`;
  els.hostContrastValue.textContent = `${state.videoFx.contrast}%`;
  els.hostZoomValue.textContent = `${(state.videoFx.zoom / 100).toFixed(1)}x`;
}

function syncHostFxUi() {
  els.hostFxPanel.classList.toggle("hidden", !state.isHostFxOpen);
  els.hostFxToggleBtn.setAttribute("aria-expanded", state.isHostFxOpen ? "true" : "false");
  els.hostFxToggleBtn.textContent = state.isHostFxOpen ? "Cerrar ajustes" : "Ajustes";
}

function toggleHostFxPanel(forcedState) {
  if (typeof forcedState === "boolean") {
    state.isHostFxOpen = forcedState;
  } else {
    state.isHostFxOpen = !state.isHostFxOpen;
  }
  syncHostFxUi();
}

function updateHostVideoFx(property, rawValue) {
  if (property === "infrared") {
    state.videoFx.infrared = Boolean(rawValue);
  } else if (property === "brightness") {
    state.videoFx.brightness = clampInt(rawValue, 60, 220, HOST_VIDEO_FX_DEFAULTS.brightness);
  } else if (property === "contrast") {
    state.videoFx.contrast = clampInt(rawValue, 60, 220, HOST_VIDEO_FX_DEFAULTS.contrast);
  } else if (property === "zoom") {
    state.videoFx.zoom = clampInt(rawValue, 100, 300, HOST_VIDEO_FX_DEFAULTS.zoom);
  }

  syncHostFxInputs();
  persistHostVideoFx();
}

function resetHostVideoFx() {
  state.videoFx = { ...HOST_VIDEO_FX_DEFAULTS };
  syncHostFxInputs();
  persistHostVideoFx();
}

function updateShareArtifacts() {
  const selectedUrl = syncShareUrlOptions(state.selectedShareUrl || getShareUrl());
  state.selectedShareUrl = selectedUrl;
  syncViewerAnchor();
  const qrSelectedUrl = syncQrUrlOptions(selectedUrl);
  if (!els.qrModal.classList.contains("hidden")) {
    updateQrModalArtifacts(qrSelectedUrl);
  }
}

function syncShareUrlOptions(preferredUrl = "") {
  const options = getShareCandidates();
  const fallback = options[0] || getShareUrl();
  const normalizedPreferred = typeof preferredUrl === "string" ? preferredUrl.trim() : "";
  const selectedUrl = options.includes(normalizedPreferred) ? normalizedPreferred : fallback;

  els.shareUrlSelect.textContent = "";
  for (const url of options) {
    const option = document.createElement("option");
    option.value = url;
    option.textContent = simplifyQrUrlLabel(url);
    els.shareUrlSelect.append(option);
  }

  if (selectedUrl) {
    els.shareUrlSelect.value = selectedUrl;
  }

  return selectedUrl;
}

function collectLocalWatchUrls() {
  const urls = [];
  for (const item of state.config.localWatchUrls || []) {
    if (typeof item === "string" && item.trim()) {
      urls.push(item.trim());
    }
  }
  urls.push(`${window.location.origin.replace(/\/+$/g, "")}/watch`);
  return [...new Set(urls)];
}

function getShareCandidates() {
  if (state.streamMode === "secure") {
    return [getShareUrl()];
  }
  return collectLocalWatchUrls();
}

function getShareUrl() {
  if (state.streamMode === "local") {
    const localUrls = collectLocalWatchUrls();
    const firstLan = localUrls.find((url) => !url.includes("localhost") && !url.includes("127.0.0.1"));
    return firstLan || localUrls[0];
  }

  const roomId = state.activeRoomId || generateRoomId();
  const key = state.accessKey || generateAccessKey();
  const base = (state.config.publicBaseUrl || window.location.origin).replace(/\/+$/g, "");
  return `${base}/watch/${encodeURIComponent(roomId)}?key=${encodeURIComponent(key)}`;
}

function getJoinPayload() {
  if (state.streamMode === "local") {
    return {
      mode: "local",
      roomId: LOCAL_ROOM_ID
    };
  }

  const roomId = sanitizeRoomId(els.roomInput.value) || generateRoomId();
  const accessKey = sanitizeAccessKey(els.accessKeyInput.value);
  state.activeRoomId = roomId;
  state.accessKey = accessKey;
  syncSecureInputs();
  updateShareArtifacts();

  if (accessKey.length < 8) {
    setEvent("Clave invalida: usa minimo 8 caracteres.");
    return null;
  }

  return {
    mode: "secure",
    roomId,
    accessKey
  };
}

function openQrModal(preferredUrl = "") {
  const selectedUrl = syncQrUrlOptions(preferredUrl || getSelectedShareUrl());
  updateQrModalArtifacts(selectedUrl);
  els.qrModal.classList.remove("hidden");
}

function closeQrModal() {
  els.qrModal.classList.add("hidden");
}

function updateQrModalArtifacts(shareUrl) {
  const url = shareUrl || getSelectedShareUrl();
  els.qrModalImg.src = `/api/qr?text=${encodeURIComponent(url)}`;
  els.qrModalLink.href = url;
  els.qrModalUrl.textContent = url;
}

function syncQrUrlOptions(preferredUrl = "") {
  const candidates = getQrCandidateUrls();
  const fallback = candidates[0] || getShareUrl();
  const normalizedPreferred = typeof preferredUrl === "string" ? preferredUrl.trim() : "";
  const selectedUrl = candidates.includes(normalizedPreferred) ? normalizedPreferred : fallback;

  els.qrUrlSelect.textContent = "";
  for (const url of candidates) {
    const option = document.createElement("option");
    option.value = url;
    option.textContent = simplifyQrUrlLabel(url);
    els.qrUrlSelect.append(option);
  }

  if (selectedUrl) {
    els.qrUrlSelect.value = selectedUrl;
  }

  return selectedUrl;
}

function getQrCandidateUrls() {
  return [...new Set(getShareCandidates().filter((url) => typeof url === "string" && url.trim()))];
}

function simplifyQrUrlLabel(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url;
  }
}

async function nativeShare() {
  const url = getSelectedShareUrl();
  if (!navigator.share) {
    setEvent("Web Share no disponible. Usa Ver QR.");
    return;
  }

  try {
    await navigator.share({
      title: "BabyCam",
      text: "Abrir monitor en vivo",
      url
    });
  } catch {
    setEvent("No se compartio el link.");
  }
}

function getSelectedShareUrl() {
  return state.selectedShareUrl || els.shareUrlSelect.value || getShareUrl();
}

function syncViewerAnchor() {
  const activeUrl = getSelectedShareUrl();
  els.viewerAnchor.href = activeUrl;
  els.viewerAnchor.title = activeUrl;
}

function setStatus(text, tone = "warn") {
  els.statusText.textContent = text;
  els.statusDot.classList.remove("ok", "err");
  if (tone === "ok") {
    els.statusDot.classList.add("ok");
  }
  if (tone === "err") {
    els.statusDot.classList.add("err");
  }
}

function setEvent(text) {
  els.eventText.textContent = text;
}

function stopStream(stream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function emitWithAck(eventName, payload) {
  return new Promise((resolve) => {
    socket.emit(eventName, payload, (response) => {
      resolve(response || { ok: false, error: "unknown" });
    });
  });
}

function sanitizeRoomId(value) {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 64);
}

function sanitizeAccessKey(value) {
  return (value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 64);
}

function getRoomFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return sanitizeRoomId(params.get("room"));
}

function getAccessKeyFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return sanitizeAccessKey(params.get("key"));
}

function generateRoomId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `baby-${random}`;
}

function generateAccessKey() {
  const partA = Math.random().toString(36).slice(2, 8);
  const partB = Math.random().toString(36).slice(2, 8);
  return sanitizeAccessKey(`${partA}${partB}`);
}

async function acquireBestEffortStream(cameraId, micId, qualityPreset) {
  const videoExact = buildVideoConstraints(cameraId, qualityPreset, "exact");
  const videoIdeal = buildVideoConstraints(cameraId, qualityPreset, "ideal");

  const attempts = [];

  attempts.push({
    video: videoExact,
    audio: micId ? { deviceId: { exact: micId } } : true
  });
  attempts.push({
    video: videoIdeal,
    audio: micId ? { deviceId: { ideal: micId } } : true
  });
  attempts.push({
    video: buildVideoConstraints("", qualityPreset, "none"),
    audio: true
  });

  let lastError = null;
  for (const constraints of attempts) {
    try {
      const stream = await tryGetUserMedia(constraints);
      const hasAudio = stream.getAudioTracks().length > 0;
      if (!hasAudio) {
        setEvent("Transmitiendo solo video. Revisa permisos del microfono.");
      }
      return stream;
    } catch (error) {
      lastError = error;
    }
  }

  const videoOnlyAttempts = [
    { video: videoExact, audio: false },
    { video: videoIdeal, audio: false },
    { video: buildVideoConstraints("", qualityPreset, "none"), audio: false }
  ];
  for (const constraints of videoOnlyAttempts) {
    try {
      const stream = await tryGetUserMedia(constraints);
      setEvent("Microfono no disponible. Transmitiendo solo video.");
      return stream;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("No se pudo obtener stream");
}

async function tryGetUserMedia(constraints) {
  return navigator.mediaDevices.getUserMedia(constraints);
}

function buildVideoConstraints(cameraId, qualityPreset, deviceIdMode = "exact") {
  const quality = sanitizeQualityPreset(qualityPreset);
  const profile = getQualityProfile(quality);
  const constraints = {
    width: { ideal: profile.width },
    height: { ideal: profile.height },
    frameRate: { ideal: profile.fps, max: profile.fps }
  };

  if (deviceIdMode === "exact" && cameraId) {
    constraints.deviceId = { exact: cameraId };
  } else if (deviceIdMode === "ideal" && cameraId) {
    constraints.deviceId = { ideal: cameraId };
  }

  return constraints;
}

function getQualityProfile(qualityPreset) {
  if (qualityPreset === "save") {
    return { width: 640, height: 360, fps: 15 };
  }
  if (qualityPreset === "high") {
    return { width: 1920, height: 1080, fps: 30 };
  }
  if (qualityPreset === "ultra") {
    return { width: 1920, height: 1080, fps: 60 };
  }
  return { width: 1280, height: 720, fps: 24 };
}

function sanitizeQualityPreset(value) {
  if (value === "save" || value === "high" || value === "ultra") {
    return value;
  }
  return "balanced";
}

function loadQualityPreset() {
  try {
    const value = localStorage.getItem(QUALITY_STORAGE_KEY);
    return sanitizeQualityPreset(value);
  } catch {
    return "balanced";
  }
}

function persistQualityPreset() {
  try {
    localStorage.setItem(QUALITY_STORAGE_KEY, state.qualityPreset);
  } catch {
    /* no-op */
  }
}

function loadHostVideoFx() {
  try {
    const raw = localStorage.getItem(HOST_VIDEO_FX_STORAGE_KEY);
    if (!raw) {
      return { ...HOST_VIDEO_FX_DEFAULTS };
    }
    const parsed = JSON.parse(raw);
    return {
      brightness: clampInt(parsed?.brightness, 60, 220, HOST_VIDEO_FX_DEFAULTS.brightness),
      contrast: clampInt(parsed?.contrast, 60, 220, HOST_VIDEO_FX_DEFAULTS.contrast),
      zoom: clampInt(parsed?.zoom, 100, 300, HOST_VIDEO_FX_DEFAULTS.zoom),
      infrared: Boolean(parsed?.infrared)
    };
  } catch {
    return { ...HOST_VIDEO_FX_DEFAULTS };
  }
}

function persistHostVideoFx() {
  try {
    localStorage.setItem(HOST_VIDEO_FX_STORAGE_KEY, JSON.stringify(state.videoFx));
  } catch {
    /* no-op */
  }
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const rounded = Math.round(parsed);
  return Math.min(max, Math.max(min, rounded));
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1, Math.round(parsed));
}

function describeQualityLabel(value) {
  if (value === "save") {
    return "Ahorro";
  }
  if (value === "high") {
    return "Alta";
  }
  if (value === "ultra") {
    return "Maxima";
  }
  return "Balanceada";
}

function describeMediaError(error) {
  const name = error?.name || "Error";
  if (!window.isSecureContext) {
    return "Bloqueado por seguridad: abre Host en https o localhost.";
  }
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Permiso denegado. Habilita camara y microfono en el navegador.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No se detecto camara o microfono.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Dispositivo ocupado por otra app (Zoom, Meet, OBS, etc.).";
  }
  if (name === "OverconstrainedError") {
    return "La camara/microfono seleccionado no esta disponible.";
  }
  return `No se pudo iniciar media (${name}).`;
}

function describeJoinError(errorCode) {
  if (errorCode === "room_busy") {
    return "La sala ya tiene otro host activo.";
  }
  if (errorCode === "room_invalid") {
    return "Sala invalida.";
  }
  if (errorCode === "key_invalid") {
    return "Clave invalida: usa minimo 8 caracteres.";
  }
  return "No se pudo registrar la transmision.";
}

async function reconnectAsHost() {
  const registered = await ensureHostRegistration({ silent: true });
  if (!registered) {
    state.isRegistered = false;
    setStatus("Conectado al servidor", "ok");
    return;
  }

  if (state.isStreaming && state.localStream) {
    for (const viewerId of state.waitingViewers) {
      if (state.peers.has(viewerId)) {
        continue;
      }
      await createOfferForViewer(viewerId);
    }
    setStatus("Transmitiendo", "ok");
    setEvent("Reconectado al servidor.");
    return;
  }

  setStatus("Standby remoto", "ok");
  if (window.isSecureContext) {
    setEvent("Host listo. Puedes iniciar desde este panel o desde el viewer.");
  }
}

function scheduleHostRegistration() {
  if (state.isStreaming) {
    return;
  }
  if (registerTimer) {
    clearTimeout(registerTimer);
  }
  registerTimer = setTimeout(() => {
    ensureHostRegistration({ silent: true }).catch(() => {});
  }, 260);
}

async function ensureHostRegistration({ payload = null, silent = false } = {}) {
  if (!socket.connected) {
    state.isRegistered = false;
    if (!silent) {
      setStatus("Servidor desconectado", "err");
      setEvent("No se pudo registrar el host porque el servidor esta offline.");
    }
    return false;
  }

  const joinPayload = payload || getJoinPayload();
  if (!joinPayload) {
    return false;
  }

  const join = await emitWithAck("host:join", joinPayload);
  if (!join.ok) {
    state.isRegistered = false;
    if (!silent) {
      setEvent(describeJoinError(join.error));
    }
    return false;
  }

  state.isRegistered = true;
  return true;
}

function shortSocketId(value) {
  if (typeof value !== "string" || value.length === 0) {
    return "viewer";
  }
  return value.slice(0, 6);
}
