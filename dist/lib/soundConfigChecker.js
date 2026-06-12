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
exports.formatCheckResults = exports.summarizeCheckResults = exports.checkSoundConfigUsage = exports.checkSoundUsage = void 0;
/* eslint-disable no-useless-escape */
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
function isSoundIdReferencedInFile(soundId, file, configObjectNames) {
    if (file.content.includes(`'${soundId}'`) || file.content.includes(`"${soundId}"`)) {
        return true;
    }
    for (const objName of configObjectNames) {
        if (file.content.includes(`${objName}.${soundId}`)) {
            return true;
        }
    }
    return false;
}
function analyzeDynamicUsage(allCode, allSoundIds) {
    const prefixMap = extractFunctionPrefixMap(allCode);
    const symbolArrays = extractSymbolSuffixArrays(allCode);
    const prefixes = soundConfigPrefixes(allCode, allSoundIds);
    const prefixToKeys = new Map();
    for (const prefix of prefixes) {
        const guardSuffixes = guardSuffixesForPrefix(prefix, allCode, prefixMap, symbolArrays);
        prefixToKeys.set(prefix, expandPrefixToKeys(prefix, allSoundIds, guardSuffixes));
    }
    return { prefixes, prefixMap, prefixToKeys };
}
function fileMatchesDynamicPrefix(file, prefix, prefixMap) {
    if (file.content.includes(`\`${prefix}\$\{`)) {
        return true;
    }
    for (const [funcName, funcPrefix] of Object.entries(prefixMap)) {
        if (funcPrefix === prefix && file.content.includes(`${funcName}(`)) {
            return true;
        }
    }
    return false;
}
function yieldToUi() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
function mergeRefMaps(refs) {
    const result = new Map();
    for (const [id, paths] of refs) {
        result.set(id, [...paths].sort());
    }
    return result;
}
/** One pass over script files — avoids O(soundIds × files × heavy parse). */
async function buildCodeUsageIndex(scriptFiles, allSoundIds, allCode, configObjectNames) {
    const directRefs = new Map();
    const dynamicRefs = new Map();
    const soundIdSet = new Set(allSoundIds);
    const analysis = analyzeDynamicUsage(allCode, allSoundIds);
    const hasDynamicPatterns = analysis.prefixes.length > 0;
    const addRef = (target, soundId, filePath) => {
        if (!soundIdSet.has(soundId)) {
            return;
        }
        let paths = target.get(soundId);
        if (!paths) {
            paths = new Set();
            target.set(soundId, paths);
        }
        paths.add(filePath);
    };
    for (let i = 0; i < scriptFiles.length; i++) {
        const file = scriptFiles[i];
        for (const soundId of allSoundIds) {
            if (isSoundIdReferencedInFile(soundId, file, configObjectNames)) {
                addRef(directRefs, soundId, file.relativePath);
            }
        }
        if (hasDynamicPatterns && file.content.includes('`')) {
            if (file.content.includes('${')) {
                for (const key of collectDynamicUsedKeys(file.content, allSoundIds)) {
                    addRef(dynamicRefs, key, file.relativePath);
                }
            }
            for (const prefix of analysis.prefixes) {
                const keys = analysis.prefixToKeys.get(prefix);
                if (!(keys === null || keys === void 0 ? void 0 : keys.size) || !fileMatchesDynamicPrefix(file, prefix, analysis.prefixMap)) {
                    continue;
                }
                for (const key of keys) {
                    addRef(dynamicRefs, key, file.relativePath);
                }
            }
        }
        if (i > 0 && i % 40 === 0) {
            await yieldToUi();
        }
    }
    return {
        directRefs: mergeRefMaps(directRefs),
        dynamicRefs: mergeRefMaps(dynamicRefs),
    };
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
async function readScriptFiles(scriptsDir, excludeFsPath) {
    const files = [];
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
                files.push({
                    relativePath: path.relative(scriptsDir, fullPath).replace(/\\/g, '/'),
                    content: await fs.readFile(fullPath, 'utf-8'),
                });
            }
        }
    };
    await walk(scriptsDir);
    return files;
}
function joinScriptCode(scriptFiles) {
    return scriptFiles.map((f) => f.content).join('\n');
}
function mergeCodeRefFiles(directFiles, dynamicFiles) {
    return [...new Set([...directFiles, ...dynamicFiles])].sort();
}
function checkSoundIdsInCategory(objectName, soundIds, codeUsageIndex, sceneRefsByNormalized) {
    const used = [];
    const usedInCode = [];
    const usedOnSceneOnly = [];
    const unusedNotInScene = [];
    for (const soundId of [...new Set(soundIds.map((id) => (0, editorAsset_1.normalizeSoundId)(id)))].filter(Boolean).sort()) {
        const directFiles = codeUsageIndex.directRefs.get(soundId) || [];
        const dynamicFiles = codeUsageIndex.dynamicRefs.get(soundId) || [];
        const codeFiles = mergeCodeRefFiles(directFiles, dynamicFiles);
        if (codeFiles.length) {
            used.push(soundId);
            usedInCode.push({
                key: soundId,
                files: codeFiles,
                dynamicOnly: !directFiles.length && dynamicFiles.length > 0,
            });
            continue;
        }
        const paths = sceneRefsByNormalized[soundId];
        if (paths === null || paths === void 0 ? void 0 : paths.length) {
            used.push(soundId);
            usedOnSceneOnly.push({ key: soundId, paths: [...paths] });
        }
        else {
            unusedNotInScene.push(soundId);
        }
    }
    return { objectName, used, usedInCode, usedOnSceneOnly, unusedNotInScene };
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
    const scriptFiles = await readScriptFiles(scriptsDir, configExists ? configFsPath : undefined);
    const allCode = joinScriptCode(scriptFiles);
    const allSoundIds = [
        ...sfxSoundIds.map((id) => (0, editorAsset_1.normalizeSoundId)(id)),
        ...musicSoundIds.map((id) => (0, editorAsset_1.normalizeSoundId)(id)),
    ].filter(Boolean);
    const codeUsageIndex = await buildCodeUsageIndex(scriptFiles, allSoundIds, allCode, configObjectNames);
    const sceneRefsByNormalized = await fetchSoundIdRefsFromOpenScene(allSoundIds);
    const results = [];
    if (sfxSoundIds.length) {
        results.push(checkSoundIdsInCategory('sfxList', sfxSoundIds, codeUsageIndex, sceneRefsByNormalized));
    }
    if (musicSoundIds.length) {
        results.push(checkSoundIdsInCategory('musicList', musicSoundIds, codeUsageIndex, sceneRefsByNormalized));
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
function summarizeCheckResults(results) {
    let usedOnSceneOnly = 0;
    let unused = 0;
    let used = 0;
    let usedDynamicInCode = 0;
    for (const r of results) {
        used += r.used.length;
        usedOnSceneOnly += r.usedOnSceneOnly.length;
        unused += r.unusedNotInScene.length;
        usedDynamicInCode += r.usedInCode.filter((e) => e.dynamicOnly).length;
    }
    return {
        total: used + unused,
        used,
        usedInCode: used - usedOnSceneOnly,
        usedDynamicInCode,
        usedOnSceneOnly,
        unused,
    };
}
exports.summarizeCheckResults = summarizeCheckResults;
function formatCheckSummaryLine(summary) {
    const dynamicPart = summary.usedDynamicInCode > 0 ? `, ${summary.usedDynamicInCode} dynamic in code` : '';
    return (`Total: ${summary.used} / ${summary.total} used` +
        ` (${summary.usedInCode} in code${dynamicPart}, ${summary.usedOnSceneOnly} on scene)` +
        ` · ${summary.unused} unused`);
}
function sceneOnlyKeySet(entries) {
    return new Set(entries.map((e) => e.key));
}
function usedInCodeByKey(entries) {
    return new Map(entries.map((e) => [e.key, e]));
}
function formatCheckResults(results) {
    const lines = ['=== Sound usage (from sound node) ==='];
    for (const { objectName, used, usedInCode, usedOnSceneOnly, unusedNotInScene } of results) {
        lines.push(`\n--- ${objectName} ---`);
        const sceneOnly = sceneOnlyKeySet(usedOnSceneOnly);
        const sceneOnlyByKey = new Map(usedOnSceneOnly.map((e) => [e.key, e.paths]));
        const codeByKey = usedInCodeByKey(usedInCode);
        for (const key of used) {
            if (sceneOnly.has(key)) {
                lines.push(`✅ ${key}  (on scene)`);
                for (const p of sceneOnlyByKey.get(key) || []) {
                    lines.push(`    ${p}`);
                }
            }
            else {
                const entry = codeByKey.get(key);
                const marker = (entry === null || entry === void 0 ? void 0 : entry.dynamicOnly) ? '⚠️' : '✅';
                const suffix = (entry === null || entry === void 0 ? void 0 : entry.dynamicOnly) ? '  (dynamic — may not cover all variants)' : '';
                lines.push(`${marker} ${key}${suffix}`);
                for (const file of (entry === null || entry === void 0 ? void 0 : entry.files) || []) {
                    lines.push(`    ${file}`);
                }
            }
        }
        for (const key of unusedNotInScene) {
            lines.push(`❌ ${key}`);
        }
        lines.push(`\n${used.length} used (${usedInCode.length} in code, ${usedOnSceneOnly.length} on scene), ${unusedNotInScene.length} unused`);
    }
    const summary = summarizeCheckResults(results);
    if (summary.total > 0) {
        lines.push(`\n=== ${formatCheckSummaryLine(summary)} ===`);
    }
    return lines.join('\n');
}
exports.formatCheckResults = formatCheckResults;
