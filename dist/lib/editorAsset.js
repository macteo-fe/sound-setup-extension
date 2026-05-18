"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getScriptsFsDir = exports.getConfigFsPath = exports.getConfigDbUrl = exports.filenameToSoundKey = exports.queryAudioClipsInFolder = exports.getPathByUuid = void 0;
const path = __importStar(require("path"));
async function getPathByUuid(uuid) {
    const result = await Editor.Message.request('asset-db', 'query-path', uuid);
    if (!result) {
        throw new Error(`Asset path not found for uuid: ${uuid}`);
    }
    return result;
}
exports.getPathByUuid = getPathByUuid;
async function queryAudioClipsInFolder(folderUuid) {
    const fsPath = await getPathByUuid(folderUuid);
    const dbpath = Editor.UI.File.resolveToUrl(fsPath, 'project');
    const sfxFolderDbUrl = dbpath.replace('project', 'db');
    const assets = await Editor.Message.request('asset-db', 'query-assets', {
        pattern: `${sfxFolderDbUrl.replace(/\/+$/, '')}/**/*`,
        type: '',
    });
    return assets
        .filter((a) => a.type === 'cc.AudioClip' && a.name.endsWith('.mp3'))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((a) => ({ name: a.name, uuid: a.uuid }));
}
exports.queryAudioClipsInFolder = queryAudioClipsInFolder;
function filenameToSoundKey(filename, gameId) {
    const base = filename.replace(/\.[^.]+$/, '');
    const prefix = `${gameId}_`;
    if (base.startsWith(prefix)) {
        return base.slice(prefix.length).toUpperCase();
    }
    const underscore = base.indexOf('_');
    if (underscore >= 0) {
        return base.slice(underscore + 1).toUpperCase();
    }
    return base.toUpperCase();
}
exports.filenameToSoundKey = filenameToSoundKey;
function getConfigDbUrl(projectPath, gameId) {
    const normalized = projectPath.replace(/^\/+|\/+$/g, '');
    return `db://assets/${normalized}/scripts/DataConfig/SoundConfig${gameId}.ts`;
}
exports.getConfigDbUrl = getConfigDbUrl;
function getConfigFsPath(projectPath, gameId) {
    const normalized = projectPath.replace(/^\/+|\/+$/g, '');
    return path.join(Editor.Project.path, 'assets', normalized, 'scripts', 'DataConfig', `SoundConfig${gameId}.ts`);
}
exports.getConfigFsPath = getConfigFsPath;
function getScriptsFsDir(projectPath) {
    const normalized = projectPath.replace(/^\/+|\/+$/g, '');
    return path.join(Editor.Project.path, 'assets', normalized, 'scripts');
}
exports.getScriptsFsDir = getScriptsFsDir;
