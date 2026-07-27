"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/preload/index.ts
var preload_exports = {};
module.exports = __toCommonJS(preload_exports);
var import_electron = require("electron");
var api = {
  getState: () => import_electron.ipcRenderer.invoke("state:get"),
  saveState: (state) => import_electron.ipcRenderer.invoke("state:save", state),
  pickSounds: () => import_electron.ipcRenderer.invoke("sounds:pick"),
  readSound: (filePath) => import_electron.ipcRenderer.invoke("sound:read", filePath),
  openExternal: (url) => import_electron.ipcRenderer.invoke("app:open-external", url),
  openConfigFolder: () => import_electron.ipcRenderer.invoke("app:open-config-folder"),
  /** หาพาธจริงของไฟล์ที่ลากมาวาง (Electron ถอด File.path ออกไปแล้ว) */
  getPathForFile: (file) => import_electron.webUtils.getPathForFile(file),
  onHotkeyPlay: (callback) => {
    import_electron.ipcRenderer.on("hotkey:play", (_event, soundId) => callback(soundId));
  },
  onHotkeyStopAll: (callback) => {
    import_electron.ipcRenderer.on("hotkey:stop-all", () => callback());
  }
};
import_electron.contextBridge.exposeInMainWorld("api", api);
