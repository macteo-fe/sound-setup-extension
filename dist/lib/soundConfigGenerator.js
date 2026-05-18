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
exports.writeSoundConfigFile = exports.generateSoundConfigContent = exports.extractConfigBlock = void 0;
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
    const { gameId, sfxFiles, bgmFiles, preserveBgm, existingContent } = options;
    const sfxKeys = [...new Set(sfxFiles.map((f) => (0, editorAsset_1.filenameToSoundKey)(f, gameId)))].sort();
    const bgmKeys = [...new Set(bgmFiles.map((f) => (0, editorAsset_1.filenameToSoundKey)(f, gameId)))].sort();
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
async function writeSoundConfigFile(fsPath, content) {
    await fs.ensureDir(path.dirname(fsPath));
    await fs.writeFile(fsPath, content, 'utf-8');
}
exports.writeSoundConfigFile = writeSoundConfigFile;
