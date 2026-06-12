/* eslint-disable no-useless-escape */
import * as fs from 'fs-extra';
import * as path from 'path';
import { normalizeSoundId } from './editorAsset';

export interface UsedOnSceneOnlyEntry {
    key: string;
    paths: string[];
}

export interface UsedInCodeEntry {
    key: string;
    files: string[];
    /** Matched only via dynamic template prefix expansion (may not cover every variant). */
    dynamicOnly?: boolean;
}

export interface ConfigCheckResult {
    objectName: string;
    /** Referenced in scripts and/or serialized on the open scene */
    used: string[];
    /** Referenced in scripts with matching file paths */
    usedInCode: UsedInCodeEntry[];
    /** Used via scene only (subset of used; not referenced in scripts) */
    usedOnSceneOnly: UsedOnSceneOnlyEntry[];
    /** Not referenced in scripts and not found on the open scene */
    unusedNotInScene: string[];
}

interface ScriptFile {
    relativePath: string;
    content: string;
}

function extractObjects(lines: string[]): Record<string, string[]> {
    const objects: Record<string, string[]> = {};
    let currentObj: string | null = null;
    let buffer: string[] = [];
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
                const keys: string[] = [];
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

function extractTemplatePrefixes(allCode: string): Set<string> {
    const prefixes = new Set<string>();
    for (const match of allCode.matchAll(/`([^`$]*)\$\{[^}]+\}`/g)) {
        if (match[1]) {
            prefixes.add(match[1]);
        }
    }
    return prefixes;
}

function extractFunctionPrefixMap(allCode: string): Record<string, string> {
    const prefixMap: Record<string, string> = {};
    for (const match of allCode.matchAll(/(?:static\s+)?(\w+)\s*\([^)]*\)(?:\s*:\s*[^{]+)?\s*\{/g)) {
        const funcName = match[1];
        const chunk = allCode.slice(match.index!, match.index! + 1200);
        const ret = chunk.match(/return\s+`([^`$]*)\$\{[^}]+\}`/);
        if (ret?.[1]) {
            prefixMap[funcName] = ret[1];
        }
    }
    return prefixMap;
}

function extractSymbolSuffixArrays(allCode: string): Record<string, string[]> {
    const arrays: Record<string, string[]> = {};
    for (const match of allCode.matchAll(/(\w+)\s*:\s*\[([^\]]*)\]/g)) {
        const values = [...match[2].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
        if (values.length) {
            arrays[match[1]] = values;
        }
    }
    return arrays;
}

function resolveGuardSuffixes(funcChunk: string, symbolArrays: Record<string, string[]>): string[] | null {
    const guard =
        funcChunk.match(/(\w+(?:\.\w+)?)\s*\.\s*(\w+)\s*\.\s*includes\s*\(\s*symbolCode\s*\)/) ||
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

function soundConfigPrefixes(allCode: string, configKeys: string[]): string[] {
    const configKeySet = new Set(configKeys);
    return [...extractTemplatePrefixes(allCode)].filter((prefix) =>
        [...configKeySet].some((k) => k.startsWith(prefix) && k.length > prefix.length),
    );
}

function guardSuffixesForPrefix(
    prefix: string,
    allCode: string,
    prefixMap: Record<string, string>,
    symbolArrays: Record<string, string[]>,
): string[] | null {
    for (const [funcName, funcPrefix] of Object.entries(prefixMap)) {
        if (funcPrefix !== prefix) {
            continue;
        }
        if (!new RegExp(`\\b${funcName}\\s*\\(`).test(allCode)) {
            continue;
        }
        const funcMatch = new RegExp(
            `(?:static\\s+)?${funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\([^)]*\\)(?:\\s*:\\s*[^{]+)?\\s*\\{`,
        ).exec(allCode);
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

function expandPrefixToKeys(
    prefix: string,
    configKeys: string[],
    guardSuffixes: string[] | null,
): Set<string> {
    const keys = new Set<string>();
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

function collectDynamicUsedKeys(allCode: string, configKeys: string[]): Set<string> {
    const prefixes = soundConfigPrefixes(allCode, configKeys);
    const prefixMap = extractFunctionPrefixMap(allCode);
    const symbolArrays = extractSymbolSuffixArrays(allCode);
    const used = new Set<string>();

    for (const prefix of prefixes) {
        const guardSuffixes = guardSuffixesForPrefix(prefix, allCode, prefixMap, symbolArrays);
        for (const key of expandPrefixToKeys(prefix, configKeys, guardSuffixes)) {
            used.add(key);
        }
    }
    return used;
}

function isSoundIdReferencedInFile(
    soundId: string,
    file: ScriptFile,
    configObjectNames: string[],
): boolean {
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

interface DynamicAnalysis {
    prefixes: string[];
    prefixMap: Record<string, string>;
    prefixToKeys: Map<string, Set<string>>;
}

function analyzeDynamicUsage(allCode: string, allSoundIds: string[]): DynamicAnalysis {
    const prefixMap = extractFunctionPrefixMap(allCode);
    const symbolArrays = extractSymbolSuffixArrays(allCode);
    const prefixes = soundConfigPrefixes(allCode, allSoundIds);
    const prefixToKeys = new Map<string, Set<string>>();
    for (const prefix of prefixes) {
        const guardSuffixes = guardSuffixesForPrefix(prefix, allCode, prefixMap, symbolArrays);
        prefixToKeys.set(prefix, expandPrefixToKeys(prefix, allSoundIds, guardSuffixes));
    }
    return { prefixes, prefixMap, prefixToKeys };
}

function fileMatchesDynamicPrefix(file: ScriptFile, prefix: string, prefixMap: Record<string, string>): boolean {
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

function yieldToUi(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

interface CodeUsageIndex {
    directRefs: Map<string, string[]>;
    dynamicRefs: Map<string, string[]>;
}

function mergeRefMaps(refs: Map<string, Set<string>>): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const [id, paths] of refs) {
        result.set(id, [...paths].sort());
    }
    return result;
}

/** One pass over script files — avoids O(soundIds × files × heavy parse). */
async function buildCodeUsageIndex(
    scriptFiles: ScriptFile[],
    allSoundIds: string[],
    allCode: string,
    configObjectNames: string[],
): Promise<CodeUsageIndex> {
    const directRefs = new Map<string, Set<string>>();
    const dynamicRefs = new Map<string, Set<string>>();
    const soundIdSet = new Set(allSoundIds);
    const analysis = analyzeDynamicUsage(allCode, allSoundIds);
    const hasDynamicPatterns = analysis.prefixes.length > 0;

    const addRef = (target: Map<string, Set<string>>, soundId: string, filePath: string): void => {
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
                if (!keys?.size || !fileMatchesDynamicPrefix(file, prefix, analysis.prefixMap)) {
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

async function fetchSoundIdRefsFromOpenScene(allConfigKeys: string[]): Promise<Record<string, string[]>> {
    if (!allConfigKeys.length) {
        return {};
    }
    try {
        const raw = await Editor.Message.request('scene', 'execute-scene-script', {
            name: 'sound-setup',
            method: 'collectSoundIdRefsInScene',
            args: [allConfigKeys],
        });
        return raw && typeof raw === 'object' ? (raw as Record<string, string[]>) : {};
    } catch {
        return {};
    }
}

async function readScriptFiles(scriptsDir: string, excludeFsPath?: string): Promise<ScriptFile[]> {
    const files: ScriptFile[] = [];
    const walk = async (dir: string): Promise<void> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath);
            } else if (
                entry.isFile() &&
                /\.(ts|js)$/.test(entry.name) &&
                fullPath !== excludeFsPath
            ) {
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

function joinScriptCode(scriptFiles: ScriptFile[]): string {
    return scriptFiles.map((f) => f.content).join('\n');
}

export interface SoundUsageCheckOptions {
    scriptsDir: string;
    sfxSoundIds: string[];
    musicSoundIds: string[];
    /** Optional; when present, also matches SOUND_CONFIG.key / BGM_CONFIG.key in scripts */
    configFsPath?: string;
}

function mergeCodeRefFiles(directFiles: string[], dynamicFiles: string[]): string[] {
    return [...new Set([...directFiles, ...dynamicFiles])].sort();
}

function checkSoundIdsInCategory(
    objectName: string,
    soundIds: string[],
    codeUsageIndex: CodeUsageIndex,
    sceneRefsByNormalized: Record<string, string[]>,
): ConfigCheckResult {
    const used: string[] = [];
    const usedInCode: UsedInCodeEntry[] = [];
    const usedOnSceneOnly: UsedOnSceneOnlyEntry[] = [];
    const unusedNotInScene: string[] = [];

    for (const soundId of [...new Set(soundIds.map((id) => normalizeSoundId(id)))].filter(Boolean).sort()) {
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
        if (paths?.length) {
            used.push(soundId);
            usedOnSceneOnly.push({ key: soundId, paths: [...paths] });
        } else {
            unusedNotInScene.push(soundId);
        }
    }

    return { objectName, used, usedInCode, usedOnSceneOnly, unusedNotInScene };
}

export async function checkSoundUsage(options: SoundUsageCheckOptions): Promise<ConfigCheckResult[]> {
    const { scriptsDir, sfxSoundIds, musicSoundIds, configFsPath } = options;

    const configExists = configFsPath ? await fs.pathExists(configFsPath) : false;
    const configObjectNames: string[] = [];
    if (configExists && configFsPath) {
        const configContent = await fs.readFile(configFsPath, 'utf-8');
        const objects = extractObjects(configContent.split('\n'));
        if (objects.SOUND_CONFIG?.length) {
            configObjectNames.push('SOUND_CONFIG');
        }
        if (objects.BGM_CONFIG?.length) {
            configObjectNames.push('BGM_CONFIG');
        }
    }

    const scriptFiles = await readScriptFiles(scriptsDir, configExists ? configFsPath : undefined);
    const allCode = joinScriptCode(scriptFiles);
    const allSoundIds = [
        ...sfxSoundIds.map((id) => normalizeSoundId(id)),
        ...musicSoundIds.map((id) => normalizeSoundId(id)),
    ].filter(Boolean);
    const codeUsageIndex = await buildCodeUsageIndex(
        scriptFiles,
        allSoundIds,
        allCode,
        configObjectNames,
    );
    const sceneRefsByNormalized = await fetchSoundIdRefsFromOpenScene(allSoundIds);

    const results: ConfigCheckResult[] = [];
    if (sfxSoundIds.length) {
        results.push(checkSoundIdsInCategory('sfxList', sfxSoundIds, codeUsageIndex, sceneRefsByNormalized));
    }
    if (musicSoundIds.length) {
        results.push(checkSoundIdsInCategory('musicList', musicSoundIds, codeUsageIndex, sceneRefsByNormalized));
    }
    return results;
}

/** @deprecated Use checkSoundUsage — checks sound ids from the sound node, not the config file */
export async function checkSoundConfigUsage(
    configFsPath: string,
    scriptsDir: string,
): Promise<ConfigCheckResult[]> {
    const configContent = await fs.readFile(configFsPath, 'utf-8');
    const objects = extractObjects(configContent.split('\n'));
    return checkSoundUsage({
        scriptsDir,
        sfxSoundIds: objects.SOUND_CONFIG || [],
        musicSoundIds: objects.BGM_CONFIG || [],
        configFsPath,
    });
}

export interface CheckUsageSummary {
    total: number;
    used: number;
    usedInCode: number;
    usedDynamicInCode: number;
    usedOnSceneOnly: number;
    unused: number;
}

export function summarizeCheckResults(results: ConfigCheckResult[]): CheckUsageSummary {
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

function formatCheckSummaryLine(summary: CheckUsageSummary): string {
    const dynamicPart =
        summary.usedDynamicInCode > 0 ? `, ${summary.usedDynamicInCode} dynamic in code` : '';
    return (
        `Total: ${summary.used} / ${summary.total} used` +
        ` (${summary.usedInCode} in code${dynamicPart}, ${summary.usedOnSceneOnly} on scene)` +
        ` · ${summary.unused} unused`
    );
}

function sceneOnlyKeySet(entries: UsedOnSceneOnlyEntry[]): Set<string> {
    return new Set(entries.map((e) => e.key));
}

function usedInCodeByKey(entries: UsedInCodeEntry[]): Map<string, UsedInCodeEntry> {
    return new Map(entries.map((e) => [e.key, e]));
}

export function formatCheckResults(results: ConfigCheckResult[]): string {
    const lines: string[] = ['=== Sound usage (from sound node) ==='];
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
            } else {
                const entry = codeByKey.get(key);
                const marker = entry?.dynamicOnly ? '⚠️' : '✅';
                const suffix = entry?.dynamicOnly ? '  (dynamic — may not cover all variants)' : '';
                lines.push(`${marker} ${key}${suffix}`);
                for (const file of entry?.files || []) {
                    lines.push(`    ${file}`);
                }
            }
        }
        for (const key of unusedNotInScene) {
            lines.push(`❌ ${key}`);
        }
        lines.push(
            `\n${used.length} used (${usedInCode.length} in code, ${usedOnSceneOnly.length} on scene), ${unusedNotInScene.length} unused`,
        );
    }
    const summary = summarizeCheckResults(results);
    if (summary.total > 0) {
        lines.push(`\n=== ${formatCheckSummaryLine(summary)} ===`);
    }
    return lines.join('\n');
}
