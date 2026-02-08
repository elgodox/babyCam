import express from "express";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { Server as SocketIOServer } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 8787);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";
const DEFAULT_ICE_SERVERS = [{ urls: ["stun:stun.l.google.com:19302"] }];
const ICE_SERVERS = parseIceServers(process.env.ICE_SERVERS);
const LOCAL_ROOM_ID = "local";

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: "*"
  }
});

app.use(express.static(publicDir, { extensions: ["html"] }));

app.get("/watch/:roomId", (_req, res) => {
  res.sendFile(path.join(publicDir, "viewer.html"));
});

app.get("/watch", (_req, res) => {
  res.sendFile(path.join(publicDir, "viewer.html"));
});

app.get("/host", (_req, res) => {
  res.sendFile(path.join(publicDir, "host.html"));
});

app.get("/api/config", (_req, res) => {
  const localUrls = getLocalUrls(PORT);
  res.json({
    publicBaseUrl: PUBLIC_BASE_URL,
    iceServers: ICE_SERVERS,
    localWatchUrls: localUrls.map((url) => `${url}/watch`)
  });
});

app.get("/api/qr", async (req, res) => {
  const text = typeof req.query.text === "string" ? req.query.text.trim() : "";
  if (!text || text.length > 512) {
    res.status(400).json({ error: "Parametro text invalido" });
    return;
  }

  try {
    const svg = await QRCode.toString(text, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 220,
      color: {
        dark: "#0f172a",
        light: "#0000"
      }
    });
    res.setHeader("Content-Type", "image/svg+xml");
    res.send(svg);
  } catch (error) {
    res.status(500).json({ error: "No se pudo generar el QR" });
  }
});

const rooms = new Map();

io.on("connection", (socket) => {
  socket.data.roomId = null;
  socket.data.role = null;

  socket.on("host:join", (payload = {}, ack = () => {}) => {
    const mode = payload.mode === "secure" ? "secure" : "local";
    const roomId = mode === "local" ? LOCAL_ROOM_ID : sanitizeRoomId(payload.roomId);
    const accessKey = mode === "secure" ? sanitizeAccessKey(payload.accessKey) : "";

    if (!roomId) {
      ack({ ok: false, error: "room_invalid" });
      return;
    }
    if (mode === "secure" && roomId === LOCAL_ROOM_ID) {
      ack({ ok: false, error: "room_invalid" });
      return;
    }
    if (mode === "secure" && accessKey.length < 8) {
      ack({ ok: false, error: "key_invalid" });
      return;
    }

    leaveCurrentRoom(socket);
    const room = getOrCreateRoom(roomId);

    if (room.hostId && room.hostId !== socket.id) {
      ack({ ok: false, error: "room_busy" });
      return;
    }

    if (mode === "secure" && room.viewers.size > 0 && !room.secure) {
      for (const viewerId of room.viewers) {
        const viewerSocket = io.sockets.sockets.get(viewerId);
        viewerSocket?.leave(roomId);
        if (viewerSocket) {
          viewerSocket.data.roomId = null;
          viewerSocket.data.role = null;
        }
        io.to(viewerId).emit("host:left");
      }
      room.viewers.clear();
    }

    room.hostId = socket.id;
    room.secure = mode === "secure";
    room.accessKey = mode === "secure" ? accessKey : "";
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = "host";
    ack({
      ok: true,
      viewerCount: room.viewers.size,
      mode
    });

    for (const viewerId of room.viewers) {
      io.to(socket.id).emit("viewer:joined", { viewerId });
      io.to(viewerId).emit("host:online");
    }
  });

  socket.on("viewer:join", (payload = {}, ack = () => {}) => {
    const roomId = sanitizeRoomId(payload.roomId) || LOCAL_ROOM_ID;
    const accessKey = sanitizeAccessKey(payload.accessKey);
    if (!roomId) {
      ack({ ok: false, error: "room_invalid" });
      return;
    }

    leaveCurrentRoom(socket);
    const room = rooms.get(roomId);
    if (!room) {
      if (roomId !== LOCAL_ROOM_ID) {
        ack({ ok: false, error: "room_offline" });
        return;
      }
    }

    const roomState = room || getOrCreateRoom(roomId);
    if (roomState.secure && roomState.accessKey !== accessKey) {
      ack({ ok: false, error: "unauthorized" });
      return;
    }

    roomState.viewers.add(socket.id);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = "viewer";

    ack({
      ok: true,
      hostOnline: Boolean(roomState.hostId),
      hostId: roomState.hostId,
      secure: Boolean(roomState.secure)
    });

    if (roomState.hostId) {
      io.to(roomState.hostId).emit("viewer:joined", { viewerId: socket.id });
    }
  });

  socket.on("host:leave", () => {
    leaveCurrentRoom(socket);
  });

  socket.on("viewer:leave", () => {
    leaveCurrentRoom(socket);
  });

  socket.on("signal:offer", ({ to, description } = {}) => {
    if (!canSignal(socket, to) || !description) {
      return;
    }
    io.to(to).emit("signal:offer", { from: socket.id, description });
  });

  socket.on("signal:answer", ({ to, description } = {}) => {
    if (!canSignal(socket, to) || !description) {
      return;
    }
    io.to(to).emit("signal:answer", { from: socket.id, description });
  });

  socket.on("signal:candidate", ({ to, candidate } = {}) => {
    if (!canSignal(socket, to) || !candidate) {
      return;
    }
    io.to(to).emit("signal:candidate", { from: socket.id, candidate });
  });

  socket.on("disconnect", () => {
    leaveCurrentRoom(socket);
  });
});

server.listen(PORT, HOST, () => {
  const primaryOrigin = PUBLIC_BASE_URL || `http://localhost:${PORT}`;
  console.log(`\nBabyCam corriendo en ${primaryOrigin}`);

  for (const url of getLocalUrls(PORT)) {
    console.log(`LAN: ${url}`);
  }

  console.log("\nHost UI:");
  console.log(`${primaryOrigin}/host`);
  console.log("\nViewer URL local:");
  console.log(`${primaryOrigin}/watch`);
  console.log("\nViewer URL internet (modo secure):");
  console.log(`${primaryOrigin}/watch/mi-baby-room?key=tu-clave`);
  console.log("\nTip internet:");
  console.log("Usa HTTPS + TURN para conexiones remotas estables.");
});

function parseIceServers(rawValue) {
  if (!rawValue) {
    return DEFAULT_ICE_SERVERS;
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (error) {
    console.warn("ICE_SERVERS invalido, usando STUN por defecto.");
  }

  return DEFAULT_ICE_SERVERS;
}

function sanitizeRoomId(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 64);
}

function sanitizeAccessKey(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 64);
}

function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      hostId: null,
      viewers: new Set(),
      secure: false,
      accessKey: ""
    };
    rooms.set(roomId, room);
  }
  return room;
}

function leaveCurrentRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) {
    return;
  }

  const room = rooms.get(roomId);
  if (!room) {
    socket.data.roomId = null;
    socket.data.role = null;
    return;
  }

  if (socket.data.role === "host" && room.hostId === socket.id) {
    room.hostId = null;
    for (const viewerId of room.viewers) {
      io.to(viewerId).emit("host:left");
    }
  }

  if (socket.data.role === "viewer") {
    room.viewers.delete(socket.id);
    if (room.hostId) {
      io.to(room.hostId).emit("viewer:left", { viewerId: socket.id });
    }
  }

  socket.leave(roomId);
  socket.data.roomId = null;
  socket.data.role = null;

  if (!room.hostId && room.viewers.size === 0) {
    rooms.delete(roomId);
  }
}

function canSignal(fromSocket, toSocketId) {
  if (!fromSocket?.data?.roomId || !toSocketId) {
    return false;
  }
  const target = io.sockets.sockets.get(toSocketId);
  if (!target) {
    return false;
  }
  return target.data.roomId === fromSocket.data.roomId;
}

function getLocalUrls(port) {
  const nets = networkInterfaces();
  const urls = [];

  for (const values of Object.values(nets)) {
    if (!values) {
      continue;
    }

    for (const info of values) {
      if (info.family !== "IPv4" || info.internal) {
        continue;
      }
      urls.push(`http://${info.address}:${port}`);
    }
  }

  return urls;
}
