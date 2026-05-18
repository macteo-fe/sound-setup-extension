import { normalizeSoundId } from './editorAsset';
import type { SoundListKeys } from './soundConfigGenerator';

type EditorComp = {
    type?: string;
    value?: Record<string, unknown>;
};

export interface ExistingSfxKeysFromEditor {
    soundIds: Set<string>;
    clipUuids: Set<string>;
}

/** Unwrap Cocos inspector dump `{ value: T }` wrappers. */
function unwrapEditorValue(input: unknown): unknown {
    if (input == null || typeof input !== 'object') {
        return input;
    }
    const obj = input as Record<string, unknown>;
    if ('value' in obj) {
        return unwrapEditorValue(obj.value);
    }
    return input;
}

function readSoundIdFromListItem(item: unknown): string {
    if (item == null || typeof item !== 'object') {
        return '';
    }
    const obj = item as Record<string, unknown>;
    if ('soundId' in obj) {
        const v = unwrapEditorValue(obj.soundId);
        if (typeof v === 'string' && v) {
            return normalizeSoundId(v);
        }
    }
    return '';
}

function readClipUuidFromListItem(item: unknown): string {
    if (item == null || typeof item !== 'object') {
        return '';
    }
    const obj = item as Record<string, unknown>;
    if (!('audioFile' in obj)) {
        return '';
    }
    const audioFile = unwrapEditorValue(obj.audioFile);
    if (audioFile != null && typeof audioFile === 'object' && 'uuid' in (audioFile as object)) {
        return String((audioFile as { uuid: string }).uuid || '').trim();
    }
    return '';
}

function collectFromEditorList(
    listProp: unknown,
): { soundIds: string[]; clipUuids: string[] } {
    const list = unwrapEditorValue(listProp);
    if (!Array.isArray(list)) {
        return { soundIds: [], clipUuids: [] };
    }

    const soundIds: string[] = [];
    const clipUuids: string[] = [];
    for (const item of list) {
        const soundId = readSoundIdFromListItem(item);
        if (soundId) {
            soundIds.push(soundId);
        }
        const clipUuid = readClipUuidFromListItem(item);
        if (clipUuid) {
            clipUuids.push(clipUuid);
        }
    }
    return { soundIds, clipUuids };
}

function isSoundPlayerComponent(comp: EditorComp): boolean {
    const type = comp.type ?? '';
    if (
        type === 'SoundPlayerModuleImpl' ||
        type === 'SlotSoundPlayerModule' ||
        type.startsWith('SlotSoundPlayerModule')
    ) {
        return true;
    }
    return comp.value != null && 'sfxList' in comp.value;
}

function findSoundPlayerComp(node: Record<string, unknown>): EditorComp | null {
    const comps = (node.__comps__ as EditorComp[] | undefined) ?? [];
    return comps.find(isSoundPlayerComponent) ?? null;
}

/**
 * Read sfxList / musicList from the editor scene dump (query-node).
 * Reliable in edit mode; matches what the Inspector shows.
 */
export async function getSoundListKeysFromEditorDump(
    nodeUuid: string,
): Promise<SoundListKeys | null> {
    const node = (await Editor.Message.request('scene', 'query-node', nodeUuid)) as Record<
        string,
        unknown
    > | null;
    if (!node) {
        return null;
    }

    const soundComp = findSoundPlayerComp(node);
    if (!soundComp?.value) {
        return null;
    }

    const sfx = collectFromEditorList(soundComp.value.sfxList);
    const music = collectFromEditorList(soundComp.value.musicList);

    return {
        sfxSoundIds: sfx.soundIds,
        musicSoundIds: music.soundIds,
        nodeName: typeof node.name === 'string' ? node.name : undefined,
    };
}

export async function getExistingSfxKeysFromEditorDump(
    nodeUuid: string,
): Promise<ExistingSfxKeysFromEditor | null> {
    const node = (await Editor.Message.request('scene', 'query-node', nodeUuid)) as Record<
        string,
        unknown
    > | null;
    if (!node) {
        return null;
    }

    const soundComp = findSoundPlayerComp(node);
    if (!soundComp?.value) {
        return null;
    }

    const { soundIds, clipUuids } = collectFromEditorList(soundComp.value.sfxList);
    return {
        soundIds: new Set(soundIds),
        clipUuids: new Set(clipUuids),
    };
}

async function getSoundListKeysFromSceneScript(nodeUuid: string): Promise<SoundListKeys> {
    const raw = await Editor.Message.request('scene', 'execute-scene-script', {
        name: 'sound-setup',
        method: 'getSoundListKeys',
        args: [nodeUuid],
    });

    const data = (raw ?? {}) as Partial<SoundListKeys>;
    return {
        sfxSoundIds: Array.isArray(data.sfxSoundIds)
            ? data.sfxSoundIds.map((id) => normalizeSoundId(id))
            : [],
        musicSoundIds: Array.isArray(data.musicSoundIds)
            ? data.musicSoundIds.map((id) => normalizeSoundId(id))
            : [],
        nodeName: data.nodeName,
    };
}

/** Editor dump first; scene script fallback for play-mode / edge cases. */
export async function getSoundListKeysFromNode(nodeUuid: string): Promise<SoundListKeys> {
    const fromEditor = await getSoundListKeysFromEditorDump(nodeUuid);
    if (fromEditor?.sfxSoundIds.length || fromEditor?.musicSoundIds.length) {
        return fromEditor;
    }

    try {
        const fromScene = await getSoundListKeysFromSceneScript(nodeUuid);
        if (fromScene.sfxSoundIds.length || fromScene.musicSoundIds.length) {
            return fromScene;
        }
    } catch {
        /* scene script may be unavailable */
    }

    return (
        fromEditor ?? {
            sfxSoundIds: [],
            musicSoundIds: [],
        }
    );
}
