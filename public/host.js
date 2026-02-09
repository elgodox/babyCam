const socket = io();
const LOCAL_ROOM_ID = "local";
const QUALITY_STORAGE_KEY = "babycam-quality";

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
  shareLinkInput: document.getElementById("shareLinkInput"),
  localUrlsBox: document.getElementById("localUrlsBox"),
  copyBtn: document.getElementById("copyBtn"),
  shareBtn: document.getElementById("shareBtn"),
  viewerAnchor: document.getElementById("viewerAnchor"),
  shareFooter: document.getElementById("shareFooter"),
  qrWrap: document.getElementById("qrWrap"),
  qrImg: document.getElementById("qrImg"),
  viewerCount: document.getElementById("viewerCount")
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
  localStream: null,
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

  els.startBtn.addEventListener("click", startHosting);
  els.stopBtn.addEventListener("click", stopHosting);
  els.copyBtn.addEventListener("click", copyShareLink);
  els.shareBtn.addEventListener("click", nativeShare);

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
  if (!state.isStreaming && !state.localStream) {
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

  const freshStream = await acquireBestEffortStream(cameraId, micId, state.qualityPreset);
  els.previewVideo.srcObject = freshStream;
  await els.previewVideo.play().catch(() => {});

  if (state.localStream) {
    await replaceTracksOnPeers(freshStream);
    stopStream(state.localStream);
  }

  state.localStream = freshStream;
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
  els.qrWrap.classList.toggle("hidden", !secure);
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

function updateShareArtifacts() {
  const shareUrl = getShareUrl();
  els.shareLinkInput.value = shareUrl;
  els.viewerAnchor.href = shareUrl;
  els.qrImg.src = `/api/qr?text=${encodeURIComponent(shareUrl)}`;
  renderLocalUrls();
}

function renderLocalUrls() {
  const urls = collectLocalWatchUrls();
  els.localUrlsBox.textContent = "";
  if (urls.length === 0) {
    els.localUrlsBox.textContent = "No se detectaron URLs LAN automaticamente.";
    return;
  }

  const frag = document.createDocumentFragment();
  for (const url of urls) {
    const row = document.createElement("div");
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.textContent = url;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    row.append(anchor);
    frag.append(row);
  }
  els.localUrlsBox.append(frag);
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

async function copyShareLink() {
  const value = els.shareLinkInput.value;
  try {
    await navigator.clipboard.writeText(value);
    setEvent("Link copiado al portapapeles.");
  } catch {
    setEvent("No se pudo copiar el link.");
  }
}

async function nativeShare() {
  const url = els.shareLinkInput.value;
  if (!navigator.share) {
    setEvent("Web Share no disponible. Usa Copiar link.");
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
