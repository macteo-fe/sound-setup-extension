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
exports.formatCheckResults = exports.checkSoundConfigUsage = void 0;
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
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
function isKeyUsed(key, objName, allCode, dynamicUsedKeys) {
    if (dynamicUsedKeys.has(key)) {
        return true;
    }
    if (new RegExp(`\\b${objName}\\.${key}\\b`).test(allCode)) {
        return true;
    }
    if (new RegExp(`['"]${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(allCode)) {
        return true;
    }
    return false;
}
async function readAllScriptCode(scriptsDir, configFileName) {
    let allCode = '';
    const walk = async (dir) => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath);
            }
            else if (entry.isFile() && /\.(ts|js)$/.test(entry.name) && !fullPath.endsWith(configFileName)) {
                allCode += `${await fs.readFile(fullPath, 'utf-8')}\n`;
            }
        }
    };
    await walk(scriptsDir);
    return allCode;
}
async function checkSoundConfigUsage(configFsPath, scriptsDir) {
    const configContent = await fs.readFile(configFsPath, 'utf-8');
    const objects = extractObjects(configContent.split('\n'));
    const configFileName = path.basename(configFsPath);
    const allCode = await readAllScriptCode(scriptsDir, configFileName);
    const dynamicUsedKeys = collectDynamicUsedKeys(allCode, objects.SOUND_CONFIG || []);
    const results = [];
    for (const [objName, keys] of Object.entries(objects)) {
        const used = [];
        const unused = [];
        for (const key of keys.sort()) {
            if (isKeyUsed(key, objName, allCode, dynamicUsedKeys)) {
                used.push(key);
            }
            else {
                unused.push(key);
            }
        }
        results.push({ objectName: objName, used, unused });
    }
    return results;
}
exports.checkSoundConfigUsage = checkSoundConfigUsage;
function formatCheckResults(results) {
    const lines = ['=== Sound config usage ==='];
    for (const { objectName, used, unused } of results) {
        lines.push(`\n--- ${objectName} ---`);
        for (const key of used) {
            lines.push(`✅ ${objectName}.${key}`);
        }
        for (const key of unused) {
            lines.push(`❌ ${objectName}.${key}`);
        }
        lines.push(`\n${used.length} used, ${unused.length} unused`);
    }
    return lines.join('\n');
}
exports.formatCheckResults = formatCheckResults;
