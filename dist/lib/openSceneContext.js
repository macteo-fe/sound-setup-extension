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
exports.refreshInspectorByReselectNode = exports.formatSceneContextHint = exports.detectGameContextFromOpenScene = exports.getOpenSceneDbUrl = exports.findGameIdFromSoundConfig = exports.extractGameId = exports.parseSceneDbUrl = void 0;
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
/** Parse db://assets/{projectPath}/{name}.scene */
function parseSceneDbUrl(dbUrl) {
    const normalized = String(dbUrl || '').replace(/\\/g, '/');
    const match = normalized.match(/^db:\/\/assets\/(.+)\/([^/]+)\.scene$/i);
    if (!match) {
        return null;
    }
    return {
        projectPath: match[1].replace(/\/+$/, ''),
        sceneBaseName: match[2],
    };
}
exports.parseSceneDbUrl = parseSceneDbUrl;
/** Derive game id from folder name, scene name, or SoundConfig file on disk. */
function extractGameId(projectPath, sceneBaseName) {
    const folderMatch = projectPath.match(/-(\d{3,6})$/);
    if (folderMatch) {
        return folderMatch[1];
    }
    const sceneMatch = sceneBaseName.match(/^g(\d{3,6})/i);
    if (sceneMatch) {
        return sceneMatch[1];
    }
    const folderDigits = projectPath.match(/(\d{3,6})/);
    if (folderDigits) {
        return folderDigits[1];
    }
    return '';
}
exports.extractGameId = extractGameId;
async function findGameIdFromSoundConfig(projectPath) {
    const configDir = path.join(Editor.Project.path, 'assets', projectPath.replace(/^\/+|\/+$/g, ''), 'scripts', 'DataConfig');
    if (!(await fs.pathExists(configDir))) {
        return null;
    }
    const files = await fs.readdir(configDir);
    for (const file of files) {
        const match = file.match(/^SoundConfig(\d+)\.ts$/);
        if (match) {
            return match[1];
        }
    }
    return null;
}
exports.findGameIdFromSoundConfig = findGameIdFromSoundConfig;
async function resolveSceneDbUrlFromAssetUuid(uuid, fallbackSceneName) {
    const dbUrl = await Editor.Message.request('asset-db', 'query-url', uuid);
    if (dbUrl && String(dbUrl).toLowerCase().endsWith('.scene')) {
        return {
            dbUrl: String(dbUrl),
            sceneName: fallbackSceneName || path.basename(String(dbUrl), '.scene'),
        };
    }
    try {
        const fsPath = await Editor.Message.request('asset-db', 'query-path', uuid);
        if (!fsPath || !String(fsPath).toLowerCase().endsWith('.scene')) {
            return null;
        }
        const projectUrl = Editor.UI.File.resolveToUrl(String(fsPath), 'project');
        const resolvedDbUrl = projectUrl.replace(/^project/, 'db');
        if (!resolvedDbUrl.toLowerCase().endsWith('.scene')) {
            return null;
        }
        return {
            dbUrl: resolvedDbUrl,
            sceneName: fallbackSceneName || path.basename(String(fsPath), '.scene'),
        };
    }
    catch (_a) {
        return null;
    }
}
async function getOpenSceneDbUrl() {
    var _a;
    try {
        const assetUuid = await Editor.Message.request('scene', 'query-current-scene-uuid');
        if (assetUuid) {
            const resolved = await resolveSceneDbUrlFromAssetUuid(String(assetUuid));
            if (resolved) {
                return resolved;
            }
        }
    }
    catch (_b) {
        /* query-current-scene-uuid may be unavailable */
    }
    try {
        const raw = (await Editor.Message.request('scene', 'execute-scene-script', {
            name: 'sound-setup',
            method: 'getOpenSceneInfo',
            args: [],
        }));
        const uuid = (_a = raw === null || raw === void 0 ? void 0 : raw.uuid) === null || _a === void 0 ? void 0 : _a.trim();
        if (!uuid) {
            return null;
        }
        return resolveSceneDbUrlFromAssetUuid(uuid, raw === null || raw === void 0 ? void 0 : raw.name);
    }
    catch (_c) {
        /* no active scene */
    }
    return null;
}
exports.getOpenSceneDbUrl = getOpenSceneDbUrl;
async function detectGameContextFromOpenScene() {
    var _a;
    const open = await getOpenSceneDbUrl();
    if (!open) {
        return null;
    }
    const parsed = parseSceneDbUrl(open.dbUrl);
    if (!parsed) {
        return null;
    }
    let gameId = extractGameId(parsed.projectPath, parsed.sceneBaseName);
    if (!gameId) {
        gameId = (_a = (await findGameIdFromSoundConfig(parsed.projectPath))) !== null && _a !== void 0 ? _a : '';
    }
    if (!gameId) {
        return null;
    }
    return {
        gameId,
        projectPath: parsed.projectPath,
        sceneDbUrl: open.dbUrl,
        sceneName: parsed.sceneBaseName,
    };
}
exports.detectGameContextFromOpenScene = detectGameContextFromOpenScene;
function formatSceneContextHint(ctx) {
    return `From open scene: ${ctx.sceneName}.scene → ${ctx.projectPath} (${ctx.gameId})`;
}
exports.formatSceneContextHint = formatSceneContextHint;
/**
 * Force Inspector to refresh by re-selecting the node.
 * This avoids `open-scene` compatibility issues across Creator versions.
 */
function refreshInspectorByReselectNode(nodeUuid) {
    const id = nodeUuid === null || nodeUuid === void 0 ? void 0 : nodeUuid.trim();
    if (!id) {
        return false;
    }
    try {
        Editor.Selection.clear('node');
        Editor.Selection.select('node', id);
        return true;
    }
    catch (e) {
        console.warn('[sound-setup] failed to refresh Inspector selection', e);
        return false;
    }
}
exports.refreshInspectorByReselectNode = refreshInspectorByReselectNode;
