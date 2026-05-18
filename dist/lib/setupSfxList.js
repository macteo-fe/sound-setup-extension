"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupSfxListOnNode = exports.formatSetupSfxListHtml = exports.buildSfxEntriesFromFolder = void 0;
const editorAsset_1 = require("./editorAsset");
function buildSfxEntriesFromFolder(clips, gameId) {
    return clips.map((clip) => ({
        soundId: (0, editorAsset_1.filenameToSoundKey)(clip.name, gameId),
        clipUuid: clip.uuid,
        fileName: clip.name,
    }));
}
exports.buildSfxEntriesFromFolder = buildSfxEntriesFromFolder;
function partitionEntries(entries, existingIds) {
    const addedItems = [];
    const skippedItems = [];
    for (const entry of entries) {
        const soundId = entry.soundId.toUpperCase();
        const detail = { fileName: entry.fileName, soundId };
        if (existingIds.has(soundId)) {
            skippedItems.push(detail);
        }
        else {
            addedItems.push(detail);
        }
    }
    return { addedItems, skippedItems };
}
async function getExistingSfxSoundIds(nodeUuid) {
    const ids = await Editor.Message.request('scene', 'execute-scene-script', {
        name: 'sound-setup',
        method: 'getExistingSfxSoundIds',
        args: [nodeUuid],
    });
    return Array.isArray(ids) ? ids.map((id) => String(id).toUpperCase()) : [];
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
            lines.push(`<motion.div class="warn">− ${item.fileName} → ${item.soundId}</div>`);
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
    const existingIds = new Set(await getExistingSfxSoundIds(nodeUuid));
    const { addedItems, skippedItems } = partitionEntries(entries, existingIds);
    const raw = await Editor.Message.request('scene', 'execute-scene-script', {
        name: 'sound-setup',
        method: 'setupSfxList',
        args: [nodeUuid, entries],
    });
    await Editor.Message.request('scene', 'save-scene');
    return normalizeSetupResult(raw, addedItems, skippedItems);
}
exports.setupSfxListOnNode = setupSfxListOnNode;
