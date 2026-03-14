import { app, BrowserWindow, Menu, Tray, nativeImage, session, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT, startBabyCamServer } from "../app-server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = new Set(process.argv.slice(1));
const startHidden = args.has("--hidden");
const defaultPort = Number(process.env.PORT || DEFAULT_PORT);
const defaultOrigin = `http://127.0.0.1:${defaultPort}`;

let tray = null;
let mainWindow = null;
let isQuitting = false;
let serverHandle = null;

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on("second-instance", () => {
  showMainWindow();
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", (event) => {
  if (!isQuitting) {
    event.preventDefault();
  }
});

app.on("activate", () => {
  showMainWindow();
});

app.whenReady()
  .then(async () => {
    app.setAppUserModelId("BabyCam.Service");
    setupPermissionHandlers();
    serverHandle = await startOrAttachServer();
    createMainWindow();
    createTray();
    if (!startHidden) {
      showMainWindow();
    }
  })
  .catch((error) => {
    console.error("No se pudo iniciar BabyCam Service:", error);
    app.quit();
  });

async function startOrAttachServer() {
  try {
    const server = await startBabyCamServer();
    return {
      origin: `http://127.0.0.1:${server.config.port}`,
      async stop() {
        await server.stop();
      }
    };
  } catch (error) {
    if (error?.code !== "EADDRINUSE") {
      throw error;
    }
    console.warn(`Puerto ${defaultPort} ocupado. Se reutiliza servidor existente.`);
    return {
      origin: defaultOrigin,
      async stop() {}
    };
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 960,
    minHeight: 720,
    show: false,
    backgroundColor: "#09101c",
    title: "BabyCam Service",
    autoHideMenuBar: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(`${serverHandle.origin}/host?desktop=1&autostart=1`);
}

function createTray() {
  const icon = nativeImage
    .createFromPath(path.join(__dirname, "..", "docs", "host-preview.png"))
    .resize({ width: 16, height: 16 });

  tray = new Tray(icon);
  tray.setToolTip("BabyCam Service");
  tray.on("double-click", () => {
    showMainWindow();
  });
  refreshTrayMenu();
}

function refreshTrayMenu() {
  const openAtLogin = app.getLoginItemSettings().openAtLogin;
  const menu = Menu.buildFromTemplate([
    {
      label: "Abrir panel",
      click: () => showMainWindow()
    },
    {
      label: "Abrir viewer local",
      click: () => {
        void shell.openExternal(`${serverHandle.origin}/watch`);
      }
    },
    {
      label: "Iniciar con Windows",
      type: "checkbox",
      checked: openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({
          openAtLogin: item.checked,
          args: ["--hidden"]
        });
        refreshTrayMenu();
      }
    },
    { type: "separator" },
    {
      label: "Salir",
      click: () => {
        void shutdownAndQuit();
      }
    }
  ]);

  tray?.setContextMenu(menu);
}

function showMainWindow() {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function setupPermissionHandlers() {
  const ses = session.defaultSession;
  ses.setPermissionCheckHandler((_webContents, permission) => permission === "media");
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });
}

async function shutdownAndQuit() {
  if (isQuitting) {
    return;
  }

  isQuitting = true;
  tray?.destroy();
  tray = null;

  if (serverHandle) {
    await serverHandle.stop();
  }

  app.quit();
}
