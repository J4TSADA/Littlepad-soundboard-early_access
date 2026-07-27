"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/main/index.ts
var import_electron2 = require("electron");
var import_promises = __toESM(require("node:fs/promises"));
var import_node_path2 = __toESM(require("node:path"));

// src/main/store.ts
var import_electron = require("electron");
var import_node_fs = __toESM(require("node:fs"));
var import_node_path = __toESM(require("node:path"));

// src/shared/types.ts
var DEFAULT_SETTINGS = {
  masterVolume: 0.8,
  virtualDeviceId: null,
  monitorDeviceId: null,
  micDeviceId: null,
  monitorEnabled: true,
  micPassthrough: true,
  micVolume: 1,
  hotkeysEnabled: true,
  stopAllHotkey: "F9",
  retriggerMode: "restart"
};

// src/main/store.ts
function filePath() {
  return import_node_path.default.join(import_electron.app.getPath("userData"), "soundpad.json");
}
function sanitizeSound(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw;
  if (typeof r.id !== "string" || typeof r.filePath !== "string") return null;
  return {
    id: r.id,
    name: typeof r.name === "string" ? r.name : import_node_path.default.basename(r.filePath),
    filePath: r.filePath,
    hotkey: typeof r.hotkey === "string" && r.hotkey.length > 0 ? r.hotkey : null,
    volume: typeof r.volume === "number" ? Math.min(1, Math.max(0, r.volume)) : 1
  };
}
function loadState() {
  try {
    const text = import_node_fs.default.readFileSync(filePath(), "utf8");
    const parsed = JSON.parse(text);
    const sounds = Array.isArray(parsed.sounds) ? parsed.sounds.map(sanitizeSound).filter((s) => s !== null) : [];
    const settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
    return { sounds, settings };
  } catch {
    return { sounds: [], settings: { ...DEFAULT_SETTINGS } };
  }
}
function saveState(state2) {
  const target = filePath();
  const tmp = `${target}.tmp`;
  import_node_fs.default.mkdirSync(import_node_path.default.dirname(target), { recursive: true });
  import_node_fs.default.writeFileSync(tmp, JSON.stringify(state2, null, 2), "utf8");
  import_node_fs.default.renameSync(tmp, target);
}
function configPath() {
  return filePath();
}

// src/main/index.ts
var win = null;
var state = { sounds: [], settings: { ...DEFAULT_SETTINGS } };
var AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus", "webm"];
function createWindow() {
  win = new import_electron2.BrowserWindow({
    width: 480,
    height: 700,
    minWidth: 420,
    minHeight: 520,
    title: "Littlepad",
    backgroundColor: "#101219",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: import_node_path2.default.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.once("ready-to-show", () => win?.show());
  void win.loadFile(import_node_path2.default.join(__dirname, "..", "renderer", "index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void import_electron2.shell.openExternal(url);
    return { action: "deny" };
  });
}
function registerHotkeys() {
  import_electron2.globalShortcut.unregisterAll();
  const failed = [];
  if (!state.settings.hotkeysEnabled) return { failed };
  const bind = (accelerator, action) => {
    try {
      if (!import_electron2.globalShortcut.register(accelerator, action)) failed.push(accelerator);
    } catch {
      failed.push(accelerator);
    }
  };
  for (const sound of state.sounds) {
    if (!sound.hotkey) continue;
    bind(sound.hotkey, () => win?.webContents.send("hotkey:play", sound.id));
  }
  if (state.settings.stopAllHotkey) {
    bind(state.settings.stopAllHotkey, () => win?.webContents.send("hotkey:stop-all"));
  }
  return { failed };
}
function registerIpc() {
  import_electron2.ipcMain.handle("state:get", () => state);
  import_electron2.ipcMain.handle("state:save", (_event, next) => {
    state = next;
    saveState(state);
    return registerHotkeys();
  });
  import_electron2.ipcMain.handle("sounds:pick", async () => {
    if (!win) return [];
    const result = await import_electron2.dialog.showOpenDialog(win, {
      title: "\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E44\u0E1F\u0E25\u0E4C\u0E40\u0E2A\u0E35\u0E22\u0E07",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "\u0E44\u0E1F\u0E25\u0E4C\u0E40\u0E2A\u0E35\u0E22\u0E07", extensions: AUDIO_EXTENSIONS }]
    });
    if (result.canceled) return [];
    return result.filePaths.map((filePath2) => ({
      filePath: filePath2,
      name: import_node_path2.default.basename(filePath2, import_node_path2.default.extname(filePath2))
    }));
  });
  import_electron2.ipcMain.handle("sound:read", async (_event, filePath2) => {
    if (typeof filePath2 !== "string") return null;
    if (!AUDIO_EXTENSIONS.includes(import_node_path2.default.extname(filePath2).slice(1).toLowerCase())) return null;
    try {
      const buffer = await import_promises.default.readFile(filePath2);
      return new Uint8Array(buffer);
    } catch {
      return null;
    }
  });
  import_electron2.ipcMain.handle("app:open-external", async (_event, url) => {
    if (typeof url === "string" && url.startsWith("https://")) await import_electron2.shell.openExternal(url);
  });
  import_electron2.ipcMain.handle("app:open-config-folder", () => {
    import_electron2.shell.showItemInFolder(configPath());
  });
}
if (!import_electron2.app.requestSingleInstanceLock()) {
  import_electron2.app.quit();
} else {
  import_electron2.app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  void import_electron2.app.whenReady().then(() => {
    state = loadState();
    registerIpc();
    createWindow();
    registerHotkeys();
    import_electron2.app.on("activate", () => {
      if (import_electron2.BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}
import_electron2.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") import_electron2.app.quit();
});
import_electron2.app.on("will-quit", () => {
  import_electron2.globalShortcut.unregisterAll();
});
