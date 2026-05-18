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

export function generateSoundConfigContent(options: {
    sfxSoundIds: string[];
    musicSoundIds?: string[];
    preserveBgm: boolean;
    existingContent?: string;
}): string {
    const { sfxSoundIds, musicSoundIds = [], preserveBgm, existingContent } = options;

    const sfxKeys = [...new Set(sfxSoundIds.map((id) => normalizeSoundId(id)))].filter(Boolean).sort();
    const bgmKeys = [...new Set(musicSoundIds.map((id) => normalizeSoundId(id)))].filter(Boolean).sort();

    const parts: string[] = [buildConfigBlock('SOUND_CONFIG', sfxKeys)];

    if (bgmKeys.length > 0) {
        parts.push('');
        parts.push(buildConfigBlock('BGM_CONFIG', bgmKeys));
    } else if (preserveBgm && existingContent) {
        const bgmBlock = extractConfigBlock(existingContent, 'BGM_CONFIG');
        if (bgmBlock) {
            parts.push('');
            parts.push(bgmBlock);
        }
    }

    return `${parts.join('\n')}\n`;
}

export { getSoundListKeysFromNode } from './soundListFromNode';

export function formatGenerateConfigHtml(
    configPath: string,
    lists: SoundListKeys,
    preserveBgm: boolean,
): string {
    const lines: string[] = [
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

export async function writeSoundConfigFile(fsPath: string, content: string): Promise<void> {
    await fs.ensureDir(path.dirname(fsPath));
    await fs.writeFile(fsPath, content, 'utf-8');
}
