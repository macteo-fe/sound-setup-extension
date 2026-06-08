import * as fs from 'fs-extra';
import * as path from 'path';
import { normalizeSoundId } from './editorAsset';

export interface UnusedOnSceneEntry {
    key: string;
    paths: string[];
}

export interface ConfigCheckResult {
    objectName: string;
    used: string[];
    /** Not referenced in scripts and not found on the open scene */
    unusedNotInScene: string[];
    /** Not referenced in scripts but serialized on the open scene */
    unusedOnScene: UnusedOnSceneEntry[];
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

function isSoundIdUsed(
    soundId: string,
    allCode: string,
    dynamicUsedKeys: Set<string>,
    configObjectNames: string[] = [],
): boolean {
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

async function readAllScriptCode(scriptsDir: string, excludeFsPath?: string): Promise<string> {
    let allCode = '';
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
                allCode += `${await fs.readFile(fullPath, 'utf-8')}\n`;
            }
        }
    };
    await walk(scriptsDir);
    return allCode;
}

export interface SoundUsageCheckOptions {
    scriptsDir: string;
    sfxSoundIds: string[];
    musicSoundIds: string[];
    /** Optional; when present, also matches SOUND_CONFIG.key / BGM_CONFIG.key in scripts */
    configFsPath?: string;
}

function checkSoundIdsInCategory(
    objectName: string,
    soundIds: string[],
    allCode: string,
    dynamicUsedKeys: Set<string>,
    configObjectNames: string[],
    sceneRefsByNormalized: Record<string, string[]>,
): ConfigCheckResult {
    const used: string[] = [];
    const unusedNotInScene: string[] = [];
    const unusedOnScene: UnusedOnSceneEntry[] = [];

    for (const soundId of [...new Set(soundIds.map((id) => normalizeSoundId(id)))].filter(Boolean).sort()) {
        if (isSoundIdUsed(soundId, allCode, dynamicUsedKeys, configObjectNames)) {
            used.push(soundId);
        } else {
            const paths = sceneRefsByNormalized[soundId];
            if (paths?.length) {
                unusedOnScene.push({ key: soundId, paths: [...paths] });
            } else {
                unusedNotInScene.push(soundId);
            }
        }
    }

    return { objectName, used, unusedNotInScene, unusedOnScene };
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

    const allCode = await readAllScriptCode(scriptsDir, configExists ? configFsPath : undefined);
    const allSoundIds = [
        ...sfxSoundIds.map((id) => normalizeSoundId(id)),
        ...musicSoundIds.map((id) => normalizeSoundId(id)),
    ].filter(Boolean);
    const dynamicUsedKeys = collectDynamicUsedKeys(allCode, allSoundIds);
    const sceneRefsByNormalized = await fetchSoundIdRefsFromOpenScene(allSoundIds);

    const results: ConfigCheckResult[] = [];
    if (sfxSoundIds.length) {
        results.push(
            checkSoundIdsInCategory(
                'sfxList',
                sfxSoundIds,
                allCode,
                dynamicUsedKeys,
                configObjectNames,
                sceneRefsByNormalized,
            ),
        );
    }
    if (musicSoundIds.length) {
        results.push(
            checkSoundIdsInCategory(
                'musicList',
                musicSoundIds,
                allCode,
                dynamicUsedKeys,
                configObjectNames,
                sceneRefsByNormalized,
            ),
        );
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

export function formatCheckResults(results: ConfigCheckResult[]): string {
    const lines: string[] = ['=== Sound usage (from sound node) ==='];
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
        lines.push(
            `\n${used.length} used in code, ${unusedTotal} unused in code (${unusedOnScene.length} on scene, ${unusedNotInScene.length} not on scene)`,
        );
    }
    return lines.join('\n');
}
