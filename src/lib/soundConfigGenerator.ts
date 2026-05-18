import * as fs from 'fs-extra';
import * as path from 'path';
import { filenameToSoundKey } from './editorAsset';

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
    gameId: string;
    sfxFiles: string[];
    bgmFiles: string[];
    preserveBgm: boolean;
    existingContent?: string;
}): string {
    const { gameId, sfxFiles, bgmFiles, preserveBgm, existingContent } = options;

    const sfxKeys = [...new Set(sfxFiles.map((f) => filenameToSoundKey(f, gameId)))].sort();
    const bgmKeys = [...new Set(bgmFiles.map((f) => filenameToSoundKey(f, gameId)))].sort();

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

export async function writeSoundConfigFile(fsPath: string, content: string): Promise<void> {
    await fs.ensureDir(path.dirname(fsPath));
    await fs.writeFile(fsPath, content, 'utf-8');
}
