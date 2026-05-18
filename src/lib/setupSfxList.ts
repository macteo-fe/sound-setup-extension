import { filenameToSoundKey, queryAudioClipsInFolder } from './editorAsset';

export interface SfxListEntry {
    soundId: string;
    clipUuid: string;
    fileName: string;
}

export interface SfxListItemDetail {
    fileName: string;
    soundId: string;
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

function partitionEntries(
    entries: SfxListEntry[],
    existingIds: Set<string>,
): { addedItems: SfxListItemDetail[]; skippedItems: SfxListItemDetail[] } {
    const addedItems: SfxListItemDetail[] = [];
    const skippedItems: SfxListItemDetail[] = [];

    for (const entry of entries) {
        const soundId = entry.soundId.toUpperCase();
        const detail = { fileName: entry.fileName, soundId };
        if (existingIds.has(soundId)) {
            skippedItems.push(detail);
        } else {
            addedItems.push(detail);
        }
    }

    return { addedItems, skippedItems };
}

async function getExistingSfxSoundIds(nodeUuid: string): Promise<string[]> {
    const ids = await Editor.Message.request('scene', 'execute-scene-script', {
        name: 'sound-setup',
        method: 'getExistingSfxSoundIds',
        args: [nodeUuid],
    });
    return Array.isArray(ids) ? ids.map((id) => String(id).toUpperCase()) : [];
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
            lines.push(`<div class="warn">− ${item.fileName} → ${item.soundId}</div>`);
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
    const existingIds = new Set(await getExistingSfxSoundIds(nodeUuid));
    const { addedItems, skippedItems } = partitionEntries(entries, existingIds);

    const raw = await Editor.Message.request('scene', 'execute-scene-script', {
        name: 'sound-setup',
        method: 'setupSfxList',
        args: [nodeUuid, entries],
    });

    await Editor.Message.request('scene', 'save-scene');

    return normalizeSetupResult(raw as Partial<SetupSfxListResult>, addedItems, skippedItems);
}
