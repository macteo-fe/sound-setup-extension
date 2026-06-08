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
exports.formatCheckResults = exports.checkSoundConfigUsage = exports.checkSoundUsage = void 0;
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const editorAsset_1 = require("./editorAsset");
function extractObjects(lines) {
    const objects = {};
    let currentObj = null;
    let buffer = [];
    let braceCount = 0;
    for (const line of lines) {
        const startMatch = line.match(/^\s*export\s+const\s+(\w+)\s*=\s*\{/);
        if (startMatch) {
            currentObj = startMatch[1];
            buffer = [];
            braceCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
            continue;
        }
        if (currentObj) {
            buffer.push(line);
            braceCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
            if (braceCount === 0) {
                const block = buffer.join('');
                const pairs = [...block.matchAll(/(\w+)\s*:\s*([^,\n]+)/g)];
                const keys = [];
                for (const [, key, value] of pairs) {
                    const trimmed = value.trim();
                    if (/^['"].*['"]$/.test(trimmed)) {
                        keys.push(key);
                    }
                }
                objects[currentObj] = [...new Set(keys)];
                currentObj = null;
                buffer = [];
            }
        }
    }
    return objects;
}
function extractTemplatePrefixes(allCode) {
    const prefixes = new Set();
    for (const match of allCode.matchAll(/`([^`$]*)\$\{[^}]+\}`/g)) {
        if (match[1]) {
            prefixes.add(match[1]);
        }
    }
    return prefixes;
}
function extractFunctionPrefixMap(allCode) {
    const prefixMap = {};
    for (const match of allCode.matchAll(/(?:static\s+)?(\w+)\s*\([^)]*\)(?:\s*:\s*[^{]+)?\s*\{/g)) {
        const funcName = match[1];
        const chunk = allCode.slice(match.index, match.index + 1200);
        const ret = chunk.match(/return\s+`([^`$]*)\$\{[^}]+\}`/);
        if (ret === null || ret === void 0 ? void 0 : ret[1]) {
            prefixMap[funcName] = ret[1];
        }
    }
    return prefixMap;
}
function extractSymbolSuffixArrays(allCode) {
    const arrays = {};
    for (const match of allCode.matchAll(/(\w+)\s*:\s*\[([^\]]*)\]/g)) {
        const values = [...match[2].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
        if (values.length) {
            arrays[match[1]] = values;
        }
    }
    return arrays;
}
function resolveGuardSuffixes(funcChunk, symbolArrays) {
    const guard = funcChunk.match(/(\w+(?:\.\w+)?)\s*\.\s*(\w+)\s*\.\s*includes\s*\(\s*symbolCode\s*\)/) ||
        funcChunk.match(/(\w+)\s*\.\s*includes\s*\(\s*symbolCode\s*\)/);
    if (!guard) {
        return null;
    }
    const arrayName = guard[2] || guard[3];
    if (arrayName && symbolArrays[arrayName]) {
        return symbolArrays[arrayName];
    }
    return null;
}
function soundConfigPrefixes(allCode, configKeys) {
    const configKeySet = new Set(configKeys);
    return [...extractTemplatePrefixes(allCode)].filter((prefix) => [...configKeySet].some((k) => k.startsWith(prefix) && k.length > prefix.length));
}
function guardSuffixesForPrefix(prefix, allCode, prefixMap, symbolArrays) {
    for (const [funcName, funcPrefix] of Object.entries(prefixMap)) {
        if (funcPrefix !== prefix) {
            continue;
        }
        if (!new RegExp(`\\b${funcName}\\s*\\(`).test(allCode)) {
            continue;
        }
        const funcMatch = new RegExp(`(?:static\\s+)?${funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\([^)]*\\)(?:\\s*:\\s*[^{]+)?\\s*\\{`).exec(allCode);
        if (!funcMatch) {
            continue;
        }
        const chunk = allCode.slice(funcMatch.index, funcMatch.index + 1200);
        const suffixes = resolveGuardSuffixes(chunk, symbolArrays);
        if (suffixes) {
            return suffixes;
        }
    }
    return null;
}
function expandPrefixToKeys(prefix, configKeys, guardSuffixes) {
    const keys = new Set();
    for (const key of configKeys) {
        if (!key.startsWith(prefix) || key.length <= prefix.length) {
            continue;
        }
        const suffix = key.slice(prefix.length);
        if (guardSuffixes !== null && !guardSuffixes.includes(suffix)) {
            continue;
        }
        keys.add(key);
    }
    return keys;
}
function collectDynamicUsedKeys(allCode, configKeys) {
    const prefixes = soundConfigPrefixes(allCode, configKeys);
    const prefixMap = extractFunctionPrefixMap(allCode);
    const symbolArrays = extractSymbolSuffixArrays(allCode);
    const used = new Set();
    for (const prefix of prefixes) {
        const guardSuffixes = guardSuffixesForPrefix(prefix, allCode, prefixMap, symbolArrays);
        for (const key of expandPrefixToKeys(prefix, configKeys, guardSuffixes)) {
            used.add(key);
        }
    }
    return used;
}
function isSoundIdUsed(soundId, allCode, dynamicUsedKeys, configObjectNames = []) {
    if (dynamicUsedKeys.has(soundId)) {
        return true;
    }
    const escaped = soundId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`['"]${escaped}['"]`).test(allCode)) {
        return true;
    }
    for (const objName of configObjectNames) {
        if (new RegExp(`\\b${objName}\\.${escaped}\\b`).test(allCode)) {
            return true;
        }
    }
    return false;
}
async function fetchSoundIdRefsFromOpenScene(allConfigKeys) {
    if (!allConfigKeys.length) {
        return {};
    }
    try {
        const raw = await Editor.Message.request('scene', 'execute-scene-script', {
            name: 'sound-setup',
            method: 'collectSoundIdRefsInScene',
            args: [allConfigKeys],
        });
        return raw && typeof raw === 'object' ? raw : {};
    }
    catch (_a) {
        return {};
    }
}
async function readAllScriptCode(scriptsDir, excludeFsPath) {
    let allCode = '';
    const walk = async (dir) => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath);
            }
            else if (entry.isFile() &&
                /\.(ts|js)$/.test(entry.name) &&
                fullPath !== excludeFsPath) {
                allCode += `${await fs.readFile(fullPath, 'utf-8')}\n`;
            }
        }
    };
    await walk(scriptsDir);
    return allCode;
}
function checkSoundIdsInCategory(objectName, soundIds, allCode, dynamicUsedKeys, configObjectNames, sceneRefsByNormalized) {
    const used = [];
    const unusedNotInScene = [];
    const unusedOnScene = [];
    for (const soundId of [...new Set(soundIds.map((id) => (0, editorAsset_1.normalizeSoundId)(id)))].filter(Boolean).sort()) {
        if (isSoundIdUsed(soundId, allCode, dynamicUsedKeys, configObjectNames)) {
            used.push(soundId);
        }
        else {
            const paths = sceneRefsByNormalized[soundId];
            if (paths === null || paths === void 0 ? void 0 : paths.length) {
                unusedOnScene.push({ key: soundId, paths: [...paths] });
            }
            else {
                unusedNotInScene.push(soundId);
            }
        }
    }
    return { objectName, used, unusedNotInScene, unusedOnScene };
}
async function checkSoundUsage(options) {
    var _a, _b;
    const { scriptsDir, sfxSoundIds, musicSoundIds, configFsPath } = options;
    const configExists = configFsPath ? await fs.pathExists(configFsPath) : false;
    const configObjectNames = [];
    if (configExists && configFsPath) {
        const configContent = await fs.readFile(configFsPath, 'utf-8');
        const objects = extractObjects(configContent.split('\n'));
        if ((_a = objects.SOUND_CONFIG) === null || _a === void 0 ? void 0 : _a.length) {
            configObjectNames.push('SOUND_CONFIG');
        }
        if ((_b = objects.BGM_CONFIG) === null || _b === void 0 ? void 0 : _b.length) {
            configObjectNames.push('BGM_CONFIG');
        }
    }
    const allCode = await readAllScriptCode(scriptsDir, configExists ? configFsPath : undefined);
    const allSoundIds = [
        ...sfxSoundIds.map((id) => (0, editorAsset_1.normalizeSoundId)(id)),
        ...musicSoundIds.map((id) => (0, editorAsset_1.normalizeSoundId)(id)),
    ].filter(Boolean);
    const dynamicUsedKeys = collectDynamicUsedKeys(allCode, allSoundIds);
    const sceneRefsByNormalized = await fetchSoundIdRefsFromOpenScene(allSoundIds);
    const results = [];
    if (sfxSoundIds.length) {
        results.push(checkSoundIdsInCategory('sfxList', sfxSoundIds, allCode, dynamicUsedKeys, configObjectNames, sceneRefsByNormalized));
    }
    if (musicSoundIds.length) {
        results.push(checkSoundIdsInCategory('musicList', musicSoundIds, allCode, dynamicUsedKeys, configObjectNames, sceneRefsByNormalized));
    }
    return results;
}
exports.checkSoundUsage = checkSoundUsage;
/** @deprecated Use checkSoundUsage — checks sound ids from the sound node, not the config file */
async function checkSoundConfigUsage(configFsPath, scriptsDir) {
    const configContent = await fs.readFile(configFsPath, 'utf-8');
    const objects = extractObjects(configContent.split('\n'));
    return checkSoundUsage({
        scriptsDir,
        sfxSoundIds: objects.SOUND_CONFIG || [],
        musicSoundIds: objects.BGM_CONFIG || [],
        configFsPath,
    });
}
exports.checkSoundConfigUsage = checkSoundConfigUsage;
function formatCheckResults(results) {
    const lines = ['=== Sound usage (from sound node) ==='];
    for (const { objectName, used, unusedNotInScene, unusedOnScene } of results) {
        lines.push(`\n--- ${objectName} ---`);
        for (const key of used) {
            lines.push(`✅ ${key}`);
        }
        for (const { key, paths } of unusedOnScene) {
            lines.push(`⚠️  ${key}  (appear on scene; not in code)`);
            for (const p of paths) {
                lines.push(`    ${p}`);
            }
        }
        for (const key of unusedNotInScene) {
            lines.push(`❌ ${key}`);
        }
        const unusedTotal = unusedNotInScene.length + unusedOnScene.length;
        lines.push(`\n${used.length} used in code, ${unusedTotal} unused in code (${unusedOnScene.length} on scene, ${unusedNotInScene.length} not on scene)`);
    }
    return lines.join('\n');
}
exports.formatCheckResults = formatCheckResults;
