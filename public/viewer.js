const socket = io();
const stageEl = document.getElementById("videoStage");
const videoEl = document.getElementById("remoteVideo");
const dotEl = document.getElementById("viewerDot");
const statusEl = document.getElementById("viewerStatus");
const roomLabelEl = document.getElementById("roomLabel");
const streamBtn = document.getElementById("streamBtn");
const retryBtn = document.getElementById("retryBtn");
const muteBtn = document.getElementById("muteBtn");
const formatBtn = document.getElementById("formatBtn");
const fsBtn = document.getElementById("fsBtn");
const fxBtn = document.getElementById("fxBtn");
const fxPanel = document.getElementById("fxPanel");
const fxCloseBtn = document.getElementById("fxCloseBtn");
const brightnessRange = document.getElementById("brightnessRange");
const brightnessValue = document.getElementById("brightnessValue");
const contrastRange = document.getElementById("contrastRange");
const contrastValue = document.getElementById("contrastValue");
const zoomRange = document.getElementById("zoomRange");
const zoomValue = document.getElementById("zoomValue");
const infraToggle = document.getElementById("infraToggle");
const fxResetBtn = document.getElementById("fxResetBtn");

const VIDEO_FORMATS = [
  { id: "auto", label: "Auto", ratio: null },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 }
];
const VIDEO_FORMAT_STORAGE_KEY = "babycam-video-format";
const VIDEO_FX_STORAGE_KEY = "babycam-video-fx";
const VIDEO_FX_DEFAULTS = Object.freeze({
  brightness: 100,
  contrast: 100,
  zoom: 100,
  infrared: false
});

const state = {
  roomId: getRoomId(),
  accessKey: getAccessKey(),
  iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
  pc: null,
  hostId: null,
  controlPending: false,
  isLive: false,
  formatMode: loadVideoFormatMode(),
  fxPanelOpen: false,
  videoFx: loadVideoFx()
};

init().catch((error) => {
  setStatus(error.message || "Error", "err");
});

async function init() {
  if (!state.roomId) {
    throw new Error("Sala invalida");
  }
  roomLabelEl.textContent = state.roomId === "local" ? "local" : state.roomId;
  videoEl.autoplay = true;
  videoEl.playsInline = true;
  videoEl.muted = false;
  syncStreamButton();
  syncMuteButton();
  applyVideoFormat();
  syncFormatButton();
  syncFxControls();
  applyVideoFx();
  syncFxPanel();
  syncFxButton();

  await loadConfig();
  bindUi();
  bindSocket();
  window.addEventListener("resize", applyVideoFormat);
  tryJoinRoom();
}

function bindUi() {
  retryBtn.addEventListener("click", tryJoinRoom);
  streamBtn.addEventListener("click", toggleRemoteStreamControl);
  fxBtn.addEventListener("click", () => toggleFxPanel());
  fxCloseBtn.addEventListener("click", () => toggleFxPanel(false));
  brightnessRange.addEventListener("input", () => updateVideoFx("brightness", brightnessRange.value));
  contrastRange.addEventListener("input", () => updateVideoFx("contrast", contrastRange.value));
  zoomRange.addEventListener("input", () => updateVideoFx("zoom", zoomRange.value));
  infraToggle.addEventListener("change", () => updateVideoFx("infrared", infraToggle.checked));
  fxResetBtn.addEventListener("click", resetVideoFx);

  muteBtn.addEventListener("click", async () => {
    if (videoEl.muted) {
      videoEl.muted = false;
      try {
        await videoEl.play();
        muteBtn.classList.remove("needs-gesture");
        if (state.isLive) {
          setStatus("En vivo", "ok");
        }
      } catch {
        videoEl.muted = true;
        muteBtn.classList.add("needs-gesture");
      }
    } else {
      videoEl.muted = true;
      muteBtn.classList.remove("needs-gesture");
    }
    syncMuteButton();
  });

  formatBtn.addEventListener("click", cycleVideoFormat);

  fsBtn.addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      setStatus("Fullscreen no disponible", "warn");
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.fxPanelOpen) {
      toggleFxPanel(false);
    }
  });
}

function bindSocket() {
  socket.on("connect", () => {
    setStatus("Conectando sala...", "warn");
    tryJoinRoom();
  });

  socket.on("disconnect", () => {
    setStatus("Servidor desconectado", "err");
    state.isLive = false;
    syncStreamButton();
    closePeer();
  });

  socket.on("host:online", () => {
    setStatus("Host online, esperando video...", "warn");
  });

  socket.on("host:left", () => {
    setStatus("Host desconectado", "warn");
    state.isLive = false;
    syncStreamButton();
    closePeer();
    videoEl.srcObject = null;
  });

  socket.on("signal:offer", async ({ from, description }) => {
    if (!description) {
      return;
    }

    state.hostId = from;
    await acceptOffer(from, description);
  });

  socket.on("signal:candidate", async ({ candidate }) => {
    if (!candidate || !state.pc) {
      return;
    }

    try {
      await state.pc.addIceCandidate(candidate);
    } catch {
      setStatus("Candidato ICE invalido", "warn");
    }
  });
}

async function tryJoinRoom() {
  if (!socket.connected) {
    return;
  }

  const result = await emitWithAck("viewer:join", {
    roomId: state.roomId,
    accessKey: state.accessKey
  });

  if (!result.ok) {
    setStatus(describeJoinError(result.error), "err");
    return;
  }

  state.hostId = result.hostId || null;
  if (result.hostOnline) {
    setStatus("Host online, esperando stream...", "warn");
  } else {
    setStatus("Esperando que el host se conecte...", "warn");
  }
}

async function acceptOffer(hostId, description) {
  closePeer();
  const pc = createPeer(hostId);
  await pc.setRemoteDescription(description);

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("signal:answer", {
    to: hostId,
    description: pc.localDescription
  });
}

function createPeer(hostId) {
  const pc = new RTCPeerConnection({
    iceServers: state.iceServers
  });
  state.pc = pc;

  pc.onicecandidate = (event) => {
    if (!event.candidate) {
      return;
    }
    socket.emit("signal:candidate", {
      to: hostId,
      candidate: event.candidate
    });
  };

  pc.ontrack = async (event) => {
    const [stream] = event.streams;
    if (!stream) {
      return;
    }

    videoEl.srcObject = stream;
    let audioReady = true;
    try {
      videoEl.muted = false;
      await videoEl.play();
      muteBtn.classList.remove("needs-gesture");
    } catch {
      audioReady = false;
      videoEl.muted = true;
      await videoEl.play().catch(() => {});
      muteBtn.classList.add("needs-gesture");
    }
    state.isLive = true;
    syncStreamButton();
    syncMuteButton();
    setStatus(audioReady ? "En vivo" : "En vivo (activa audio)", audioReady ? "ok" : "warn");
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      state.isLive = true;
      syncStreamButton();
      setStatus("En vivo", "ok");
      return;
    }
    if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
      if (pc.connectionState !== "connected") {
        state.isLive = false;
        syncStreamButton();
      }
      setStatus("Conexion inestable", "warn");
    }
  };

  return pc;
}

function toggleRemoteStreamControl() {
  const action = state.isLive ? "stop" : "start";
  requestRemoteStreamControl(action);
}

function cycleVideoFormat() {
  const currentIndex = VIDEO_FORMATS.findIndex((item) => item.id === state.formatMode);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % VIDEO_FORMATS.length : 0;
  state.formatMode = VIDEO_FORMATS[nextIndex].id;
  applyVideoFormat();
  syncFormatButton();
  persistVideoFormatMode();
}

function applyVideoFormat() {
  const format = getActiveFormat();
  stageEl.dataset.format = format.id;

  if (!format.ratio) {
    stageEl.style.width = "100%";
    stageEl.style.height = "100%";
    stageEl.style.left = "0";
    stageEl.style.top = "0";
    stageEl.style.transform = "none";
    return;
  }

  const vw = window.innerWidth || document.documentElement.clientWidth || 0;
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  const ratio = format.ratio;
  let width = vw;
  let height = Math.round(width / ratio);

  if (height > vh) {
    height = vh;
    width = Math.round(height * ratio);
  }

  stageEl.style.width = `${Math.max(0, width)}px`;
  stageEl.style.height = `${Math.max(0, height)}px`;
  stageEl.style.left = "50%";
  stageEl.style.top = "50%";
  stageEl.style.transform = "translate(-50%, -50%)";
}

function syncFormatButton() {
  const format = getActiveFormat();
  formatBtn.textContent = format.label;
  formatBtn.setAttribute("title", `Formato de video: ${format.label}. Tocar para cambiar.`);
}

function getActiveFormat() {
  return VIDEO_FORMATS.find((item) => item.id === state.formatMode) || VIDEO_FORMATS[0];
}

function toggleFxPanel(forcedState) {
  if (typeof forcedState === "boolean") {
    state.fxPanelOpen = forcedState;
  } else {
    state.fxPanelOpen = !state.fxPanelOpen;
  }
  syncFxPanel();
  syncFxButton();
}

function syncFxPanel() {
  fxPanel.classList.toggle("hidden", !state.fxPanelOpen);
}

function syncFxButton() {
  setIconButtonState(fxBtn, {
    icon: state.fxPanelOpen ? "close" : "fx",
    label: state.fxPanelOpen ? "Cerrar controles de imagen" : "Abrir controles de imagen"
  });
}

function syncFxControls() {
  brightnessRange.value = String(state.videoFx.brightness);
  contrastRange.value = String(state.videoFx.contrast);
  zoomRange.value = String(state.videoFx.zoom);
  infraToggle.checked = state.videoFx.infrared;

  brightnessValue.textContent = `${state.videoFx.brightness}%`;
  contrastValue.textContent = `${state.videoFx.contrast}%`;
  zoomValue.textContent = `${(state.videoFx.zoom / 100).toFixed(1)}x`;
}

function updateVideoFx(property, rawValue) {
  if (property === "infrared") {
    state.videoFx.infrared = Boolean(rawValue);
  } else if (property === "brightness") {
    state.videoFx.brightness = clampPercent(rawValue, 60, 220, VIDEO_FX_DEFAULTS.brightness);
  } else if (property === "contrast") {
    state.videoFx.contrast = clampPercent(rawValue, 60, 220, VIDEO_FX_DEFAULTS.contrast);
  } else if (property === "zoom") {
    state.videoFx.zoom = clampPercent(rawValue, 100, 300, VIDEO_FX_DEFAULTS.zoom);
  }

  syncFxControls();
  applyVideoFx();
  persistVideoFx();
}

function resetVideoFx() {
  state.videoFx = { ...VIDEO_FX_DEFAULTS };
  syncFxControls();
  applyVideoFx();
  persistVideoFx();
}

function applyVideoFx() {
  const brightnessValueFactor = state.videoFx.brightness / 100;
  const contrastValueFactor = state.videoFx.contrast / 100;
  const zoomValueFactor = state.videoFx.zoom / 100;
  const isInfrared = state.videoFx.infrared;

  const brightness = isInfrared ? brightnessValueFactor * 1.12 : brightnessValueFactor;
  const contrast = isInfrared ? contrastValueFactor * 1.25 : contrastValueFactor;
  const filter = [
    `grayscale(${isInfrared ? 1 : 0})`,
    `brightness(${brightness.toFixed(2)})`,
    `contrast(${contrast.toFixed(2)})`,
    `saturate(${isInfrared ? 0.12 : 1})`
  ].join(" ");

  videoEl.style.filter = filter;
  videoEl.style.transform = `scale(${zoomValueFactor.toFixed(2)})`;
  videoEl.classList.toggle("infrared-mode", isInfrared);
}

function closePeer() {
  if (state.pc) {
    state.pc.close();
    state.pc = null;
  }
}

async function requestRemoteStreamControl(action) {
  if (!socket.connected) {
    setStatus("Servidor desconectado", "err");
    return;
  }
  if (state.controlPending) {
    return;
  }

  state.controlPending = true;
  syncStreamButton();
  const actionLabel = action === "start" ? "inicio" : "detencion";
  setStatus(`Enviando solicitud de ${actionLabel}...`, "warn");

  try {
    const result = await emitWithAck("control:stream", { action });
    if (!result?.ok) {
      setStatus(describeControlError(result?.error, action), "err");
      return;
    }

    if (action === "start") {
      setStatus("Solicitud enviada. Esperando stream...", "warn");
      return;
    }

    closePeer();
    state.isLive = false;
    syncStreamButton();
    videoEl.srcObject = null;
    setStatus("Transmision detenida por control remoto.", "warn");
  } finally {
    state.controlPending = false;
    syncStreamButton();
  }
}

function syncStreamButton() {
  streamBtn.disabled = state.controlPending;
  const nextAction = state.isLive ? "stop" : "start";

  if (nextAction === "stop") {
    setIconButtonState(streamBtn, { icon: "stop", label: "Detener transmision" });
    return;
  }
  setIconButtonState(streamBtn, { icon: "play", label: "Iniciar transmision" });
}

function syncMuteButton() {
  if (videoEl.muted) {
    setIconButtonState(muteBtn, { icon: "volume-off", label: "Activar audio" });
    return;
  }
  setIconButtonState(muteBtn, { icon: "volume-on", label: "Silenciar" });
}

function setIconButtonState(button, { icon, label }) {
  button.dataset.icon = icon;
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    if (Array.isArray(data?.iceServers) && data.iceServers.length > 0) {
      state.iceServers = data.iceServers;
    }
  } catch {
    setStatus("Config ICE local por defecto", "warn");
  }
}

function setStatus(text, tone = "warn") {
  statusEl.textContent = text;
  dotEl.classList.remove("ok", "err");
  if (tone === "ok") {
    dotEl.classList.add("ok");
  } else if (tone === "err") {
    dotEl.classList.add("err");
  }
}

function emitWithAck(eventName, payload) {
  return new Promise((resolve) => {
    socket.emit(eventName, payload, (response) => {
      resolve(response || { ok: false, error: "unknown" });
    });
  });
}

function getRoomId() {
  const fromPath = window.location.pathname.match(/^\/watch\/([a-zA-Z0-9-]+)/);
  if (fromPath?.[1]) {
    return sanitizeRoomId(fromPath[1]);
  }
  return "local";
}

function getAccessKey() {
  const params = new URLSearchParams(window.location.search);
  return sanitizeAccessKey(params.get("key"));
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

function describeJoinError(errorCode) {
  if (errorCode === "unauthorized") {
    return "Clave de acceso invalida.";
  }
  if (errorCode === "room_offline") {
    return "Transmision no disponible aun.";
  }
  if (errorCode === "room_invalid") {
    return "Sala invalida.";
  }
  return "No se pudo unir a la sala.";
}

function describeControlError(errorCode, action) {
  if (errorCode === "host_offline") {
    return "Host offline. Abre /host en la PC de la camara.";
  }
  if (errorCode === "host_timeout") {
    return "El host no respondio a la solicitud.";
  }
  if (errorCode === "forbidden") {
    return "Control remoto no autorizado en esta sesion.";
  }
  if (errorCode === "start_failed") {
    return "El host no pudo iniciar la transmision.";
  }
  if (errorCode === "stop_failed") {
    return "El host no pudo detener la transmision.";
  }
  if (errorCode === "invalid_action") {
    return "Accion invalida.";
  }
  return action === "start"
    ? "No se pudo solicitar inicio remoto."
    : "No se pudo solicitar detencion remota.";
}

function loadVideoFormatMode() {
  try {
    const saved = localStorage.getItem(VIDEO_FORMAT_STORAGE_KEY);
    if (VIDEO_FORMATS.some((item) => item.id === saved)) {
      return saved;
    }
  } catch {
    /* no-op */
  }
  return "auto";
}

function persistVideoFormatMode() {
  try {
    localStorage.setItem(VIDEO_FORMAT_STORAGE_KEY, state.formatMode);
  } catch {
    /* no-op */
  }
}

function loadVideoFx() {
  try {
    const raw = localStorage.getItem(VIDEO_FX_STORAGE_KEY);
    if (!raw) {
      return { ...VIDEO_FX_DEFAULTS };
    }
    const parsed = JSON.parse(raw);
    return {
      brightness: clampPercent(parsed?.brightness, 60, 220, VIDEO_FX_DEFAULTS.brightness),
      contrast: clampPercent(parsed?.contrast, 60, 220, VIDEO_FX_DEFAULTS.contrast),
      zoom: clampPercent(parsed?.zoom, 100, 300, VIDEO_FX_DEFAULTS.zoom),
      infrared: Boolean(parsed?.infrared)
    };
  } catch {
    return { ...VIDEO_FX_DEFAULTS };
  }
}

function persistVideoFx() {
  try {
    localStorage.setItem(VIDEO_FX_STORAGE_KEY, JSON.stringify(state.videoFx));
  } catch {
    /* no-op */
  }
}

function clampPercent(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
}
