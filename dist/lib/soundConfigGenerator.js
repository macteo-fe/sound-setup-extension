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
exports.writeSoundConfigFile = exports.formatGenerateConfigHtml = exports.getSoundListKeysFromNode = exports.generateSoundConfigContent = exports.mergeConfigKeys = exports.extractConfigKeys = exports.extractConfigBlock = void 0;
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const editorAsset_1 = require("./editorAsset");
function buildConfigBlock(name, keys) {
    const lines = [`export const ${name} = {`];
    for (const key of keys) {
        lines.push(`    ${key}: '${key}',`);
    }
    lines.push('};');
    return lines.join('\n');
}
function extractConfigBlock(source, blockName) {
    const match = source.match(new RegExp(`export const ${blockName}\\s*=\\s*\\{[\\s\\S]*?\\n\\};`));
    return match ? match[0] : null;
}
exports.extractConfigBlock = extractConfigBlock;
/** Read existing keys from a config block, preserving file order. */
function extractConfigKeys(source, blockName) {
    const block = extractConfigBlock(source, blockName);
    if (!block) {
        return [];
    }
    const keys = [];
    const seen = new Set();
    for (const match of block.matchAll(/^\s*(\w+)\s*:/gm)) {
        const key = (0, editorAsset_1.normalizeSoundId)(match[1]);
        if (key && !seen.has(key)) {
            seen.add(key);
            keys.push(key);
        }
    }
    return keys;
}
exports.extractConfigKeys = extractConfigKeys;
function mergeConfigKeys(existing, incoming) {
    const merged = [...existing];
    const existingSet = new Set(existing.map((id) => (0, editorAsset_1.normalizeSoundId)(id)));
    const added = [];
    const skipped = [];
    const pendingAdded = new Set();
    for (const raw of incoming) {
        const key = (0, editorAsset_1.normalizeSoundId)(raw);
        if (!key) {
            continue;
        }
        if (existingSet.has(key)) {
            skipped.push(key);
            continue;
        }
        if (pendingAdded.has(key)) {
            skipped.push(key);
            continue;
        }
        pendingAdded.add(key);
        existingSet.add(key);
        added.push(key);
        merged.push(key);
    }
    return { merged, added, skipped };
}
exports.mergeConfigKeys = mergeConfigKeys;
function generateSoundConfigContent(options) {
    const { sfxSoundIds, musicSoundIds = [], preserveBgm, existingContent } = options;
    const existingSfx = existingContent ? extractConfigKeys(existingContent, 'SOUND_CONFIG') : [];
    const incomingSfx = [...new Set(sfxSoundIds.map((id) => (0, editorAsset_1.normalizeSoundId)(id)))].filter(Boolean);
    const sfx = mergeConfigKeys(existingSfx, incomingSfx);
    const parts = [buildConfigBlock('SOUND_CONFIG', sfx.merged)];
    const existingBgm = existingContent ? extractConfigKeys(existingContent, 'BGM_CONFIG') : [];
    const incomingBgm = [...new Set(musicSoundIds.map((id) => (0, editorAsset_1.normalizeSoundId)(id)))].filter(Boolean);
    if (incomingBgm.length > 0) {
        const bgm = mergeConfigKeys(existingBgm, incomingBgm);
        parts.push('');
        parts.push(buildConfigBlock('BGM_CONFIG', bgm.merged));
        return { content: `${parts.join('\n')}\n`, sfx, bgm };
    }
    const bgm = { merged: existingBgm, added: [], skipped: [] };
    if (preserveBgm && existingContent) {
        const bgmBlock = extractConfigBlock(existingContent, 'BGM_CONFIG');
        if (bgmBlock) {
            parts.push('');
            parts.push(bgmBlock);
        }
    }
    return { content: `${parts.join('\n')}\n`, sfx, bgm };
}
exports.generateSoundConfigContent = generateSoundConfigContent;
var soundListFromNode_1 = require("./soundListFromNode");
Object.defineProperty(exports, "getSoundListKeysFromNode", { enumerable: true, get: function () { return soundListFromNode_1.getSoundListKeysFromNode; } });
function formatGenerateConfigHtml(configPath, lists, preserveBgm, result) {
    const lines = [
        `<div class="ok">Generated ${configPath}</div>`,
        `<div class="info">From node: ${lists.nodeName || 'sound node'} — SFX added: ${result.sfx.added.length}, skipped (already in file): ${result.sfx.skipped.length}, total: ${result.sfx.merged.length}</div>`,
    ];
    if (result.sfx.added.length) {
        lines.push('<div class="section-title">SOUND_CONFIG added</div>');
        for (const id of result.sfx.added) {
            lines.push(`<div class="ok">+ ${id}</div>`);
        }
    }
    if (result.sfx.skipped.length) {
        lines.push('<div class="section-title">SOUND_CONFIG skipped (already exists)</div>');
        for (const id of result.sfx.skipped) {
            lines.push(`<div class="warn">− ${id}</div>`);
        }
    }
    if (result.bgm.added.length || result.bgm.skipped.length) {
        lines.push(`<div class="info">BGM — added: ${result.bgm.added.length}, skipped: ${result.bgm.skipped.length}, total: ${result.bgm.merged.length}</div>`);
        for (const id of result.bgm.added) {
            lines.push(`<div class="ok">+ ${id}</div>`);
        }
        for (const id of result.bgm.skipped) {
            lines.push(`<div class="warn">− ${id}</div>`);
        }
    }
    else if (preserveBgm && !lists.musicSoundIds.length) {
        lines.push('<div class="info">BGM_CONFIG preserved from existing file</div>');
    }
    return lines.join('');
}
exports.formatGenerateConfigHtml = formatGenerateConfigHtml;
async function writeSoundConfigFile(fsPath, content) {
    await fs.ensureDir(path.dirname(fsPath));
    await fs.writeFile(fsPath, content, 'utf-8');
}
exports.writeSoundConfigFile = writeSoundConfigFile;
