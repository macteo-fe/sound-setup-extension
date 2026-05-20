import { filenameToSoundKey, normalizeSoundId, queryAudioClipsInFolder } from './editorAsset';
import { refreshInspectorByReselectNode } from './openSceneContext';
import { getExistingSfxKeysFromEditorDump } from './soundListFromNode';

export interface SfxListEntry {
    soundId: string;
    clipUuid: string;
    fileName: string;
}

export interface SfxListItemDetail {
    fileName: string;
    soundId: string;
    reason?: string;
}

export interface ExistingSfxKeys {
    soundIds: Set<string>;
    clipUuids: Set<string>;
}

export interface SetupSfxListResult {
    added: number;
    skipped: number;
    total: number;
    nodeName?: string;
    addedItems: SfxListItemDetail[];
    skippedItems: SfxListItemDetail[];
}

export function buildSfxEntriesFromFolder(
    clips: { name: string; uuid: string }[],
    gameId: string,
): SfxListEntry[] {
    return clips.map((clip) => ({
        soundId: filenameToSoundKey(clip.name, gameId),
        clipUuid: clip.uuid,
        fileName: clip.name,
    }));
}

function getSkipReason(
    soundId: string,
    clipUuid: string,
    existing: ExistingSfxKeys,
): string | null {
    const duplicateSoundId = existing.soundIds.has(soundId);
    const duplicateClip = existing.clipUuids.has(clipUuid);
    if (duplicateSoundId && duplicateClip) {
        return 'duplicate soundId and audioFile';
    }
    if (duplicateSoundId) {
        return 'duplicate soundId';
    }
    if (duplicateClip) {
        return 'duplicate audioFile';
    }
    return null;
}

function partitionEntries(
    entries: SfxListEntry[],
    existing: ExistingSfxKeys,
): { addedItems: SfxListItemDetail[]; skippedItems: SfxListItemDetail[] } {
    const addedItems: SfxListItemDetail[] = [];
    const skippedItems: SfxListItemDetail[] = [];
    const pending: ExistingSfxKeys = {
        soundIds: new Set(existing.soundIds),
        clipUuids: new Set(existing.clipUuids),
    };

    for (const entry of entries) {
        const soundId = normalizeSoundId(entry.soundId);
        const clipUuid = entry.clipUuid.trim();
        const detail: SfxListItemDetail = { fileName: entry.fileName, soundId };

        const skipReason = getSkipReason(soundId, clipUuid, pending);
        if (skipReason) {
            skippedItems.push({ ...detail, reason: skipReason });
            continue;
        }

        pending.soundIds.add(soundId);
        pending.clipUuids.add(clipUuid);
        addedItems.push(detail);
    }

    return { addedItems, skippedItems };
}

async function getExistingSfxKeysFromScene(nodeUuid: string): Promise<ExistingSfxKeys> {
    const raw = await Editor.Message.request('scene', 'execute-scene-script', {
        name: 'sound-setup',
        method: 'getExistingSfxKeys',
        args: [nodeUuid],
    });

    const data = (raw ?? {}) as { soundIds?: string[]; clipUuids?: string[] };
    return {
        soundIds: new Set(
            Array.isArray(data.soundIds) ? data.soundIds.map((id) => normalizeSoundId(id)) : [],
        ),
        clipUuids: new Set(Array.isArray(data.clipUuids) ? data.clipUuids : []),
    };
}

async function getExistingSfxKeys(nodeUuid: string): Promise<ExistingSfxKeys> {
    const fromEditor = await getExistingSfxKeysFromEditorDump(nodeUuid);
    if (fromEditor && (fromEditor.soundIds.size || fromEditor.clipUuids.size)) {
        return fromEditor;
    }
    try {
        return await getExistingSfxKeysFromScene(nodeUuid);
    } catch {
        return fromEditor ?? { soundIds: new Set(), clipUuids: new Set() };
    }
}

function normalizeSetupResult(
    raw: Partial<SetupSfxListResult> | null | undefined,
    addedItems: SfxListItemDetail[],
    skippedItems: SfxListItemDetail[],
): SetupSfxListResult {
    return {
        added: typeof raw?.added === 'number' ? raw.added : addedItems.length,
        skipped: typeof raw?.skipped === 'number' ? raw.skipped : skippedItems.length,
        total: typeof raw?.total === 'number' ? raw.total : 0,
        nodeName: raw?.nodeName,
        addedItems,
        skippedItems,
    };
}

export function formatSetupSfxListHtml(result: SetupSfxListResult): string {
    const addedItems = result.addedItems ?? [];
    const skippedItems = result.skippedItems ?? [];

    const lines: string[] = [
        `<div class="ok">Setup SFX list on ${result.nodeName || 'node'}</div>`,
        `<div class="info">Added: ${result.added}, skipped: ${result.skipped}, total in list: ${result.total}</div>`,
    ];

    if (addedItems.length) {
        lines.push('<div class="section-title">Added</div>');
        for (const item of addedItems) {
            lines.push(`<div class="ok">+ ${item.fileName} → ${item.soundId}</div>`);
        }
    }

    if (skippedItems.length) {
        lines.push('<div class="section-title">Skipped (already in list)</div>');
        for (const item of skippedItems) {
            const reason = item.reason ? ` (${item.reason})` : '';
            lines.push(`<div class="warn">− ${item.fileName} → ${item.soundId}${reason}</div>`);
        }
    }

    return lines.join('');
}

export async function setupSfxListOnNode(
    nodeUuid: string,
    sfxFolderUuid: string,
    gameId: string,
): Promise<SetupSfxListResult> {
    const clips = await queryAudioClipsInFolder(sfxFolderUuid);
    if (!clips.length) {
        throw new Error('No mp3 AudioClip assets found in SFX folder.');
    }

    const entries = buildSfxEntriesFromFolder(clips, gameId);
    const existing = await getExistingSfxKeys(nodeUuid);
    const { addedItems, skippedItems } = partitionEntries(entries, existing);

    const raw = await Editor.Message.request('scene', 'execute-scene-script', {
        name: 'sound-setup',
        method: 'setupSfxList',
        args: [nodeUuid, entries],
    });

    await Editor.Message.request('scene', 'save-scene');

    const result = normalizeSetupResult(raw as Partial<SetupSfxListResult>, addedItems, skippedItems);

    // Inspector keeps a stale dump after runtime-only edits; force refresh by reselection.
    if (result.added > 0) {
        refreshInspectorByReselectNode(nodeUuid);
    }

    return result;
}
