"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupSfxListOnNode = exports.formatSetupSfxListHtml = exports.buildSfxEntriesFromFolder = void 0;
const editorAsset_1 = require("./editorAsset");
const soundListFromNode_1 = require("./soundListFromNode");
function buildSfxEntriesFromFolder(clips, gameId) {
    return clips.map((clip) => ({
        soundId: (0, editorAsset_1.filenameToSoundKey)(clip.name, gameId),
        clipUuid: clip.uuid,
        fileName: clip.name,
    }));
}
exports.buildSfxEntriesFromFolder = buildSfxEntriesFromFolder;
function getSkipReason(soundId, clipUuid, existing) {
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
function partitionEntries(entries, existing) {
    const addedItems = [];
    const skippedItems = [];
    const pending = {
        soundIds: new Set(existing.soundIds),
        clipUuids: new Set(existing.clipUuids),
    };
    for (const entry of entries) {
        const soundId = (0, editorAsset_1.normalizeSoundId)(entry.soundId);
        const clipUuid = entry.clipUuid.trim();
        const detail = { fileName: entry.fileName, soundId };
        const skipReason = getSkipReason(soundId, clipUuid, pending);
        if (skipReason) {
            skippedItems.push(Object.assign(Object.assign({}, detail), { reason: skipReason }));
            continue;
        }
        pending.soundIds.add(soundId);
        pending.clipUuids.add(clipUuid);
        addedItems.push(detail);
    }
    return { addedItems, skippedItems };
}
async function getExistingSfxKeysFromScene(nodeUuid) {
    const raw = await Editor.Message.request('scene', 'execute-scene-script', {
        name: 'sound-setup',
        method: 'getExistingSfxKeys',
        args: [nodeUuid],
    });
    const data = (raw !== null && raw !== void 0 ? raw : {});
    return {
        soundIds: new Set(Array.isArray(data.soundIds) ? data.soundIds.map((id) => (0, editorAsset_1.normalizeSoundId)(id)) : []),
        clipUuids: new Set(Array.isArray(data.clipUuids) ? data.clipUuids : []),
    };
}
async function getExistingSfxKeys(nodeUuid) {
    const fromEditor = await (0, soundListFromNode_1.getExistingSfxKeysFromEditorDump)(nodeUuid);
    if (fromEditor && (fromEditor.soundIds.size || fromEditor.clipUuids.size)) {
        return fromEditor;
    }
    try {
        return await getExistingSfxKeysFromScene(nodeUuid);
    }
    catch (_a) {
        return fromEditor !== null && fromEditor !== void 0 ? fromEditor : { soundIds: new Set(), clipUuids: new Set() };
    }
}
function normalizeSetupResult(raw, addedItems, skippedItems) {
    return {
        added: typeof (raw === null || raw === void 0 ? void 0 : raw.added) === 'number' ? raw.added : addedItems.length,
        skipped: typeof (raw === null || raw === void 0 ? void 0 : raw.skipped) === 'number' ? raw.skipped : skippedItems.length,
        total: typeof (raw === null || raw === void 0 ? void 0 : raw.total) === 'number' ? raw.total : 0,
        nodeName: raw === null || raw === void 0 ? void 0 : raw.nodeName,
        addedItems,
        skippedItems,
    };
}
function formatSetupSfxListHtml(result) {
    var _a, _b;
    const addedItems = (_a = result.addedItems) !== null && _a !== void 0 ? _a : [];
    const skippedItems = (_b = result.skippedItems) !== null && _b !== void 0 ? _b : [];
    const lines = [
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
exports.formatSetupSfxListHtml = formatSetupSfxListHtml;
async function setupSfxListOnNode(nodeUuid, sfxFolderUuid, gameId) {
    const clips = await (0, editorAsset_1.queryAudioClipsInFolder)(sfxFolderUuid);
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
    return normalizeSetupResult(raw, addedItems, skippedItems);
}
exports.setupSfxListOnNode = setupSfxListOnNode;
