const socket = io();
const videoEl = document.getElementById("remoteVideo");
const dotEl = document.getElementById("viewerDot");
const statusEl = document.getElementById("viewerStatus");
const roomLabelEl = document.getElementById("roomLabel");
const startRemoteBtn = document.getElementById("startRemoteBtn");
const stopRemoteBtn = document.getElementById("stopRemoteBtn");
const retryBtn = document.getElementById("retryBtn");
const muteBtn = document.getElementById("muteBtn");
const fsBtn = document.getElementById("fsBtn");
const tapAudioBtn = document.getElementById("tapAudioBtn");

const state = {
  roomId: getRoomId(),
  accessKey: getAccessKey(),
  iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
  pc: null,
  hostId: null,
  controlPending: false
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

  await loadConfig();
  bindUi();
  bindSocket();
  tryJoinRoom();
}

function bindUi() {
  retryBtn.addEventListener("click", tryJoinRoom);
  startRemoteBtn.addEventListener("click", () => {
    requestRemoteStreamControl("start");
  });
  stopRemoteBtn.addEventListener("click", () => {
    requestRemoteStreamControl("stop");
  });

  muteBtn.addEventListener("click", () => {
    videoEl.muted = !videoEl.muted;
    muteBtn.textContent = videoEl.muted ? "Activar audio" : "Silenciar";
  });

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

  tapAudioBtn.addEventListener("click", async () => {
    videoEl.muted = false;
    await videoEl.play().catch(() => {});
    tapAudioBtn.classList.add("hidden");
    muteBtn.textContent = "Silenciar";
  });
}

function bindSocket() {
  socket.on("connect", () => {
    setStatus("Conectando sala...", "warn");
    tryJoinRoom();
  });

  socket.on("disconnect", () => {
    setStatus("Servidor desconectado", "err");
    closePeer();
  });

  socket.on("host:online", () => {
    setStatus("Host online, esperando video...", "warn");
  });

  socket.on("host:left", () => {
    setStatus("Host desconectado", "warn");
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
    try {
      videoEl.muted = false;
      await videoEl.play();
      tapAudioBtn.classList.add("hidden");
      muteBtn.textContent = "Silenciar";
    } catch {
      videoEl.muted = true;
      await videoEl.play().catch(() => {});
      tapAudioBtn.classList.remove("hidden");
      muteBtn.textContent = "Activar audio";
    }
    setStatus("En vivo", "ok");
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      setStatus("En vivo", "ok");
      return;
    }
    if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
      setStatus("Conexion inestable", "warn");
    }
  };

  return pc;
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
  setRemoteButtonsBusy(true);
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
    videoEl.srcObject = null;
    setStatus("Transmision detenida por control remoto.", "warn");
  } finally {
    state.controlPending = false;
    setRemoteButtonsBusy(false);
  }
}

function setRemoteButtonsBusy(busy) {
  startRemoteBtn.disabled = busy;
  stopRemoteBtn.disabled = busy;
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
