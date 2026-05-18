import * as path from 'path';

export async function getPathByUuid(uuid: string): Promise<string> {
    const result = await Editor.Message.request('asset-db', 'query-path', uuid);
    if (!result) {
        throw new Error(`Asset path not found for uuid: ${uuid}`);
    }
    return result;
}

export async function queryAudioClipsInFolder(folderUuid: string): Promise<{ name: string; uuid: string }[]> {
    const fsPath = await getPathByUuid(folderUuid);
    const dbpath = Editor.UI.File.resolveToUrl(fsPath, 'project');
    const sfxFolderDbUrl = dbpath.replace('project', 'db');
    const assets = await Editor.Message.request('asset-db', 'query-assets', {
        pattern: `${sfxFolderDbUrl.replace(/\/+$/, '')}/**/*`,
        type: '',
    });

    return assets
        .filter((a: { type: string; name: string }) => a.type === 'cc.AudioClip' && a.name.endsWith('.mp3'))
        .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))
        .map((a: { name: string; uuid: string }) => ({ name: a.name, uuid: a.uuid }));
}

/** Uppercase sound id with all whitespace removed. */
export function normalizeSoundId(id: string): string {
    return String(id || '').replace(/\s+/g, '').toUpperCase();
}

export function filenameToSoundKey(filename: string, gameId: string): string {
    const base = filename.replace(/\.[^.]+$/, '');
    const prefix = `${gameId}_`;
    let key: string;
    if (base.startsWith(prefix)) {
        key = base.slice(prefix.length);
    } else {
        const underscore = base.indexOf('_');
        key = underscore >= 0 ? base.slice(underscore + 1) : base;
    }
    return normalizeSoundId(key);
}

export function getConfigDbUrl(projectPath: string, gameId: string): string {
    const normalized = projectPath.replace(/^\/+|\/+$/g, '');
    return `db://assets/${normalized}/scripts/DataConfig/SoundConfig${gameId}.ts`;
}

export function getConfigFsPath(projectPath: string, gameId: string): string {
    const normalized = projectPath.replace(/^\/+|\/+$/g, '');
    return path.join(Editor.Project.path, 'assets', normalized, 'scripts', 'DataConfig', `SoundConfig${gameId}.ts`);
}

export function getScriptsFsDir(projectPath: string): string {
    const normalized = projectPath.replace(/^\/+|\/+$/g, '');
    return path.join(Editor.Project.path, 'assets', normalized, 'scripts');
}
