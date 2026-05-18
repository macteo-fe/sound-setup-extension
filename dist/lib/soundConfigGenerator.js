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
exports.writeSoundConfigFile = exports.formatGenerateConfigHtml = exports.getSoundListKeysFromNode = exports.generateSoundConfigContent = exports.extractConfigBlock = void 0;
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
function generateSoundConfigContent(options) {
    const { sfxSoundIds, musicSoundIds = [], preserveBgm, existingContent } = options;
    const sfxKeys = [...new Set(sfxSoundIds.map((id) => (0, editorAsset_1.normalizeSoundId)(id)))].filter(Boolean).sort();
    const bgmKeys = [...new Set(musicSoundIds.map((id) => (0, editorAsset_1.normalizeSoundId)(id)))].filter(Boolean).sort();
    const parts = [buildConfigBlock('SOUND_CONFIG', sfxKeys)];
    if (bgmKeys.length > 0) {
        parts.push('');
        parts.push(buildConfigBlock('BGM_CONFIG', bgmKeys));
    }
    else if (preserveBgm && existingContent) {
        const bgmBlock = extractConfigBlock(existingContent, 'BGM_CONFIG');
        if (bgmBlock) {
            parts.push('');
            parts.push(bgmBlock);
        }
    }
    return `${parts.join('\n')}\n`;
}
exports.generateSoundConfigContent = generateSoundConfigContent;
var soundListFromNode_1 = require("./soundListFromNode");
Object.defineProperty(exports, "getSoundListKeysFromNode", { enumerable: true, get: function () { return soundListFromNode_1.getSoundListKeysFromNode; } });
function formatGenerateConfigHtml(configPath, lists, preserveBgm) {
    const lines = [
        `<div class="ok">Generated ${configPath}</div>`,
        `<div class="info">From node: ${lists.nodeName || 'sound node'} — SFX: ${lists.sfxSoundIds.length}, BGM: ${lists.musicSoundIds.length}${preserveBgm && !lists.musicSoundIds.length ? ' (BGM preserved from file)' : ''}</div>`,
    ];
    if (lists.sfxSoundIds.length) {
        lines.push('<div class="section-title">SOUND_CONFIG keys</div>');
        for (const id of lists.sfxSoundIds) {
            lines.push(`<div class="ok">${id}</div>`);
        }
    }
    if (lists.musicSoundIds.length) {
        lines.push('<div class="section-title">BGM_CONFIG keys</div>');
        for (const id of lists.musicSoundIds) {
            lines.push(`<div class="info">${id}</div>`);
        }
    }
    return lines.join('');
}
exports.formatGenerateConfigHtml = formatGenerateConfigHtml;
async function writeSoundConfigFile(fsPath, content) {
    await fs.ensureDir(path.dirname(fsPath));
    await fs.writeFile(fsPath, content, 'utf-8');
}
exports.writeSoundConfigFile = writeSoundConfigFile;
