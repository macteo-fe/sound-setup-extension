import * as fs from 'fs-extra';
import * as path from 'path';

export interface GameSceneContext {
    gameId: string;
    projectPath: string;
    sceneDbUrl: string;
    sceneName: string;
}

/** Parse db://assets/{projectPath}/{name}.scene */
export function parseSceneDbUrl(dbUrl: string): { projectPath: string; sceneBaseName: string } | null {
    const normalized = String(dbUrl || '').replace(/\\/g, '/');
    const match = normalized.match(/^db:\/\/assets\/(.+)\/([^/]+)\.scene$/i);
    if (!match) {
        return null;
    }
    return {
        projectPath: match[1].replace(/\/+$/, ''),
        sceneBaseName: match[2],
    };
}

/** Derive game id from folder name, scene name, or SoundConfig file on disk. */
export function extractGameId(projectPath: string, sceneBaseName: string): string {
    const folderMatch = projectPath.match(/-(\d{3,6})$/);
    if (folderMatch) {
        return folderMatch[1];
    }

    const sceneMatch = sceneBaseName.match(/^g(\d{3,6})/i);
    if (sceneMatch) {
        return sceneMatch[1];
    }

    const folderDigits = projectPath.match(/(\d{3,6})/);
    if (folderDigits) {
        return folderDigits[1];
    }

    return '';
}

export async function findGameIdFromSoundConfig(projectPath: string): Promise<string | null> {
    const configDir = path.join(
        Editor.Project.path,
        'assets',
        projectPath.replace(/^\/+|\/+$/g, ''),
        'scripts',
        'DataConfig',
    );
    if (!(await fs.pathExists(configDir))) {
        return null;
    }

    const files = await fs.readdir(configDir);
    for (const file of files) {
        const match = file.match(/^SoundConfig(\d+)\.ts$/);
        if (match) {
            return match[1];
        }
    }
    return null;
}

async function resolveSceneDbUrlFromAssetUuid(
    uuid: string,
    fallbackSceneName?: string,
): Promise<{ dbUrl: string; sceneName: string } | null> {
    const dbUrl = await Editor.Message.request('asset-db', 'query-url', uuid);
    if (dbUrl && String(dbUrl).toLowerCase().endsWith('.scene')) {
        return {
            dbUrl: String(dbUrl),
            sceneName: fallbackSceneName || path.basename(String(dbUrl), '.scene'),
        };
    }

    try {
        const fsPath = await Editor.Message.request('asset-db', 'query-path', uuid);
        if (!fsPath || !String(fsPath).toLowerCase().endsWith('.scene')) {
            return null;
        }
        const projectUrl = Editor.UI.File.resolveToUrl(String(fsPath), 'project');
        const resolvedDbUrl = projectUrl.replace(/^project/, 'db');
        if (!resolvedDbUrl.toLowerCase().endsWith('.scene')) {
            return null;
        }
        return {
            dbUrl: resolvedDbUrl,
            sceneName: fallbackSceneName || path.basename(String(fsPath), '.scene'),
        };
    } catch {
        return null;
    }
}

export async function getOpenSceneDbUrl(): Promise<{ dbUrl: string; sceneName: string } | null> {
    try {
        const assetUuid = await Editor.Message.request('scene', 'query-current-scene-uuid' as never);
        if (assetUuid) {
            const resolved = await resolveSceneDbUrlFromAssetUuid(String(assetUuid));
            if (resolved) {
                return resolved;
            }
        }
    } catch {
        /* query-current-scene-uuid may be unavailable */
    }

    try {
        const raw = (await Editor.Message.request('scene', 'execute-scene-script', {
            name: 'sound-setup',
            method: 'getOpenSceneInfo',
            args: [],
        })) as { uuid?: string; name?: string } | null;

        const uuid = raw?.uuid?.trim();
        if (!uuid) {
            return null;
        }

        return resolveSceneDbUrlFromAssetUuid(uuid, raw?.name);
    } catch {
        /* no active scene */
    }

    return null;
}

export async function detectGameContextFromOpenScene(): Promise<GameSceneContext | null> {
    const open = await getOpenSceneDbUrl();
    if (!open) {
        return null;
    }

    const parsed = parseSceneDbUrl(open.dbUrl);
    if (!parsed) {
        return null;
    }

    let gameId = extractGameId(parsed.projectPath, parsed.sceneBaseName);
    if (!gameId) {
        gameId = (await findGameIdFromSoundConfig(parsed.projectPath)) ?? '';
    }
    if (!gameId) {
        return null;
    }

    return {
        gameId,
        projectPath: parsed.projectPath,
        sceneDbUrl: open.dbUrl,
        sceneName: parsed.sceneBaseName,
    };
}

export function formatSceneContextHint(ctx: GameSceneContext): string {
    return `From open scene: ${ctx.sceneName}.scene → ${ctx.projectPath} (${ctx.gameId})`;
}

/**
 * Force Inspector to refresh by re-selecting the node.
 * This avoids `open-scene` compatibility issues across Creator versions.
 */
export function refreshInspectorByReselectNode(nodeUuid: string | undefined): boolean {
    const id = nodeUuid?.trim();
    if (!id) {
        return false;
    }
    try {
        Editor.Selection.clear('node');
        Editor.Selection.select('node', id);
        return true;
    } catch (e) {
        console.warn('[sound-setup] failed to refresh Inspector selection', e);
        return false;
    }
}
