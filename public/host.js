const socket = io();

const els = {
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
  eventText: document.getElementById("eventText"),
  roomInput: document.getElementById("roomInput"),
  regenRoomBtn: document.getElementById("regenRoomBtn"),
  cameraSelect: document.getElementById("cameraSelect"),
  micSelect: document.getElementById("micSelect"),
  refreshDevicesBtn: document.getElementById("refreshDevicesBtn"),
  applyDevicesBtn: document.getElementById("applyDevicesBtn"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  previewVideo: document.getElementById("previewVideo"),
  shareLinkInput: document.getElementById("shareLinkInput"),
  copyBtn: document.getElementById("copyBtn"),
  shareBtn: document.getElementById("shareBtn"),
  viewerAnchor: document.getElementById("viewerAnchor"),
  qrImg: document.getElementById("qrImg"),
  viewerCount: document.getElementById("viewerCount")
};

const state = {
  config: {
    publicBaseUrl: "",
    iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }]
  },
  activeRoomId: "",
  isHosting: false,
  localStream: null,
  peers: new Map()
};

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
  els.roomInput.value = state.activeRoomId;
  updateShareArtifacts();
  await refreshDevices(false);
}

function bindUi() {
  els.regenRoomBtn.addEventListener("click", () => {
    if (state.isHosting) {
      setEvent("Detene la transmision para cambiar la sala.");
      return;
    }
    state.activeRoomId = generateRoomId();
    els.roomInput.value = state.activeRoomId;
    updateShareArtifacts();
  });

  els.roomInput.addEventListener("input", () => {
    const roomId = sanitizeRoomId(els.roomInput.value);
    els.roomInput.value = roomId;
    state.activeRoomId = roomId || state.activeRoomId;
    updateShareArtifacts();
  });

  els.refreshDevicesBtn.addEventListener("click", async () => {
    try {
      await refreshDevices(true);
    } catch {
      /* no-op: mensaje ya mostrado */
    }
  });

  els.applyDevicesBtn.addEventListener("click", async () => {
    if (!state.isHosting) {
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
    if (state.isHosting) {
      reconnectAsHost().catch(() => {
        setStatus("Reconectar host fallo", "err");
      });
    } else {
      setStatus("Conectado al servidor", "ok");
    }
  });

  socket.on("disconnect", () => {
    setStatus("Servidor desconectado", "err");
    for (const viewerId of state.peers.keys()) {
      closePeer(viewerId);
    }
    state.peers.clear();
    updateViewerCount();
  });

  socket.on("viewer:joined", async ({ viewerId }) => {
    if (!state.isHosting || !viewerId || state.peers.has(viewerId)) {
      return;
    }
    await createOfferForViewer(viewerId);
    updateViewerCount();
  });

  socket.on("viewer:left", ({ viewerId }) => {
    if (viewerId) {
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
    } catch (error) {
      setEvent("No se pudo aplicar candidato ICE.");
    }
  });
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
      return;
    }

    const roomId = sanitizeRoomId(els.roomInput.value) || generateRoomId();
    state.activeRoomId = roomId;
    els.roomInput.value = roomId;
    updateShareArtifacts();

    await startOrReplaceStream();

    if (!state.isHosting) {
      const join = await emitWithAck("host:join", { roomId });
      if (!join.ok) {
        const readable = join.error === "room_busy" ? "La sala ya tiene otro host." : "Error de sala.";
        setStatus("No se pudo iniciar", "err");
        setEvent(readable);
        return;
      }
      state.isHosting = true;
    }

    setStatus("Transmitiendo", "ok");
    setEvent(`En vivo en /watch/${roomId}`);
    els.startBtn.disabled = true;
    els.stopBtn.disabled = false;
    updateViewerCount();
  } catch (error) {
    setStatus("No se pudo iniciar", "err");
    setEvent(describeMediaError(error));
  }
}

async function stopHosting() {
  socket.emit("host:leave");
  state.isHosting = false;

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
  setStatus("Standby", "warn");
  setEvent("Transmision detenida.");
}

async function startOrReplaceStream() {
  const cameraId = els.cameraSelect.value;
  const micId = els.micSelect.value;

  if (!cameraId) {
    setEvent("Necesitas al menos una camara activa.");
    throw new Error("Missing audio/video devices");
  }

  const freshStream = await acquireBestEffortStream(cameraId, micId);
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

  setEvent(`Viewer conectado (${state.peers.size}).`);
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
  els.viewerCount.textContent = String(state.peers.size);
}

function updateShareArtifacts() {
  const roomId = state.activeRoomId || generateRoomId();
  const shareUrl = getShareUrl(roomId);
  els.shareLinkInput.value = shareUrl;
  els.viewerAnchor.href = shareUrl;
  els.qrImg.src = `/api/qr?text=${encodeURIComponent(shareUrl)}`;
}

function getShareUrl(roomId) {
  const base = (state.config.publicBaseUrl || window.location.origin).replace(/\/+$/g, "");
  return `${base}/watch/${encodeURIComponent(roomId)}`;
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

function getRoomFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return sanitizeRoomId(params.get("room"));
}

function generateRoomId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `baby-${random}`;
}

async function acquireBestEffortStream(cameraId, micId) {
  const attempts = [];

  attempts.push({
    video: { deviceId: { exact: cameraId } },
    audio: micId ? { deviceId: { exact: micId } } : true
  });
  attempts.push({
    video: { deviceId: { ideal: cameraId } },
    audio: micId ? { deviceId: { ideal: micId } } : true
  });
  attempts.push({
    video: true,
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
    { video: { deviceId: { exact: cameraId } }, audio: false },
    { video: true, audio: false }
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

async function reconnectAsHost() {
  if (!state.activeRoomId) {
    return;
  }
  const join = await emitWithAck("host:join", { roomId: state.activeRoomId });
  if (!join.ok) {
    throw new Error("rejoin_failed");
  }
  setStatus("Transmitiendo", "ok");
  setEvent("Reconectado al servidor.");
}
