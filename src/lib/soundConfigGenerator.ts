import * as fs from 'fs-extra';
import * as path from 'path';
import { normalizeSoundId } from './editorAsset';

export interface SoundListKeys {
    sfxSoundIds: string[];
    musicSoundIds: string[];
    nodeName?: string;
}

function buildConfigBlock(name: string, keys: string[]): string {
    const lines = [`export const ${name} = {`];
    for (const key of keys) {
        lines.push(`    ${key}: '${key}',`);
    }
    lines.push('};');
    return lines.join('\n');
}

export function extractConfigBlock(source: string, blockName: string): string | null {
    const match = source.match(new RegExp(`export const ${blockName}\\s*=\\s*\\{[\\s\\S]*?\\n\\};`));
    return match ? match[0] : null;
}

/** Read existing keys from a config block, preserving file order. */
export function extractConfigKeys(source: string, blockName: string): string[] {
    const block = extractConfigBlock(source, blockName);
    if (!block) {
        return [];
    }
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const match of block.matchAll(/^\s*(\w+)\s*:/gm)) {
        const key = normalizeSoundId(match[1]);
        if (key && !seen.has(key)) {
            seen.add(key);
            keys.push(key);
        }
    }
    return keys;
}

export interface MergeConfigKeysResult {
    merged: string[];
    added: string[];
    skipped: string[];
}

export function mergeConfigKeys(existing: string[], incoming: string[]): MergeConfigKeysResult {
    const merged = [...existing];
    const existingSet = new Set(existing.map((id) => normalizeSoundId(id)));
    const added: string[] = [];
    const skipped: string[] = [];
    const pendingAdded = new Set<string>();

    for (const raw of incoming) {
        const key = normalizeSoundId(raw);
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

export interface GenerateSoundConfigResult {
    content: string;
    sfx: MergeConfigKeysResult;
    bgm: MergeConfigKeysResult;
}

export function generateSoundConfigContent(options: {
    sfxSoundIds: string[];
    musicSoundIds?: string[];
    preserveBgm: boolean;
    existingContent?: string;
}): GenerateSoundConfigResult {
    const { sfxSoundIds, musicSoundIds = [], preserveBgm, existingContent } = options;

    const existingSfx = existingContent ? extractConfigKeys(existingContent, 'SOUND_CONFIG') : [];
    const incomingSfx = [...new Set(sfxSoundIds.map((id) => normalizeSoundId(id)))].filter(Boolean);
    const sfx = mergeConfigKeys(existingSfx, incomingSfx);

    const parts: string[] = [buildConfigBlock('SOUND_CONFIG', sfx.merged)];

    const existingBgm = existingContent ? extractConfigKeys(existingContent, 'BGM_CONFIG') : [];
    const incomingBgm = [...new Set(musicSoundIds.map((id) => normalizeSoundId(id)))].filter(Boolean);

    if (incomingBgm.length > 0) {
        const bgm = mergeConfigKeys(existingBgm, incomingBgm);
        parts.push('');
        parts.push(buildConfigBlock('BGM_CONFIG', bgm.merged));
        return { content: `${parts.join('\n')}\n`, sfx, bgm };
    }

    const bgm: MergeConfigKeysResult = { merged: existingBgm, added: [], skipped: [] };
    if (preserveBgm && existingContent) {
        const bgmBlock = extractConfigBlock(existingContent, 'BGM_CONFIG');
        if (bgmBlock) {
            parts.push('');
            parts.push(bgmBlock);
        }
    }

    return { content: `${parts.join('\n')}\n`, sfx, bgm };
}

export { getSoundListKeysFromNode } from './soundListFromNode';

export function formatGenerateConfigHtml(
    configPath: string,
    lists: SoundListKeys,
    preserveBgm: boolean,
    result: GenerateSoundConfigResult,
): string {
    const lines: string[] = [
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
        lines.push(
            `<div class="info">BGM — added: ${result.bgm.added.length}, skipped: ${result.bgm.skipped.length}, total: ${result.bgm.merged.length}</div>`,
        );
        for (const id of result.bgm.added) {
            lines.push(`<div class="ok">+ ${id}</div>`);
        }
        for (const id of result.bgm.skipped) {
            lines.push(`<div class="warn">− ${id}</div>`);
        }
    } else if (preserveBgm && !lists.musicSoundIds.length) {
        lines.push('<div class="info">BGM_CONFIG preserved from existing file</div>');
    }

    return lines.join('');
}

export async function writeSoundConfigFile(fsPath: string, content: string): Promise<void> {
    await fs.ensureDir(path.dirname(fsPath));
    await fs.writeFile(fsPath, content, 'utf-8');
}
