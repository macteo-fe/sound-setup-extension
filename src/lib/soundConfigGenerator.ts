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

export interface SyncConfigKeysResult {
    /** Final keys in scene list order */
    merged: string[];
    added: string[];
    removed: string[];
    unchanged: string[];
}

/** Sync config keys to match the scene list exactly (add new, remove missing). */
export function syncConfigKeys(existing: string[], incoming: string[]): SyncConfigKeysResult {
    const existingSet = new Set(existing.map((id) => normalizeSoundId(id)));
    const merged: string[] = [];
    const seen = new Set<string>();
    const added: string[] = [];
    const unchanged: string[] = [];

    for (const raw of incoming) {
        const key = normalizeSoundId(raw);
        if (!key || seen.has(key)) {
            continue;
        }
        seen.add(key);
        merged.push(key);
        if (existingSet.has(key)) {
            unchanged.push(key);
        } else {
            added.push(key);
        }
    }

    const incomingSet = new Set(merged);
    const removed: string[] = [];
    for (const raw of existing) {
        const key = normalizeSoundId(raw);
        if (key && !incomingSet.has(key)) {
            removed.push(key);
        }
    }

    return { merged, added, removed, unchanged };
}

export interface GenerateSoundConfigResult {
    content: string;
    sfx: SyncConfigKeysResult;
    bgm: SyncConfigKeysResult;
}

export function generateSoundConfigContent(options: {
    sfxSoundIds: string[];
    musicSoundIds?: string[];
    preserveBgm: boolean;
    existingContent?: string;
}): GenerateSoundConfigResult {
    const { sfxSoundIds, musicSoundIds = [], preserveBgm, existingContent } = options;

    const existingSfx = existingContent ? extractConfigKeys(existingContent, 'SOUND_CONFIG') : [];
    const incomingSfx = sfxSoundIds.map((id) => normalizeSoundId(id)).filter(Boolean);
    const sfx = syncConfigKeys(existingSfx, incomingSfx);

    const parts: string[] = [buildConfigBlock('SOUND_CONFIG', sfx.merged)];

    const existingBgm = existingContent ? extractConfigKeys(existingContent, 'BGM_CONFIG') : [];
    const incomingBgm = musicSoundIds.map((id) => normalizeSoundId(id)).filter(Boolean);

    if (incomingBgm.length > 0) {
        const bgm = syncConfigKeys(existingBgm, incomingBgm);
        parts.push('');
        parts.push(buildConfigBlock('BGM_CONFIG', bgm.merged));
        return { content: `${parts.join('\n')}\n`, sfx, bgm };
    }

    const bgm: SyncConfigKeysResult = { merged: existingBgm, added: [], removed: [], unchanged: [...existingBgm] };
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
        `<div class="info">From node: ${lists.nodeName || 'sound node'} — SFX synced: +${result.sfx.added.length} −${result.sfx.removed.length}, total: ${result.sfx.merged.length}</div>`,
    ];

    if (result.sfx.added.length) {
        lines.push('<div class="section-title">SOUND_CONFIG added</div>');
        for (const id of result.sfx.added) {
            lines.push(`<div class="ok">+ ${id}</div>`);
        }
    }

    if (result.sfx.removed.length) {
        lines.push('<div class="section-title">SOUND_CONFIG removed (not on sfxList)</div>');
        for (const id of result.sfx.removed) {
            lines.push(`<div class="unused">− ${id}</div>`);
        }
    }

    if (result.bgm.added.length || result.bgm.removed.length) {
        lines.push(
            `<div class="info">BGM synced: +${result.bgm.added.length} −${result.bgm.removed.length}, total: ${result.bgm.merged.length}</div>`,
        );
        for (const id of result.bgm.added) {
            lines.push(`<div class="ok">+ ${id}</div>`);
        }
        for (const id of result.bgm.removed) {
            lines.push(`<div class="unused">− ${id}</div>`);
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
