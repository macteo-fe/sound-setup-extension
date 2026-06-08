"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSoundListKeysFromNode = exports.getExistingSfxKeysFromEditorDump = exports.getSoundListKeysFromEditorDump = void 0;
const editorAsset_1 = require("./editorAsset");
/** Unwrap Cocos inspector dump `{ value: T }` wrappers. */
function unwrapEditorValue(input) {
    if (input == null || typeof input !== 'object') {
        return input;
    }
    const obj = input;
    if ('value' in obj) {
        return unwrapEditorValue(obj.value);
    }
    return input;
}
function readSoundIdFromListItem(item) {
    if (item == null || typeof item !== 'object') {
        return '';
    }
    const obj = item;
    if ('soundId' in obj) {
        const v = unwrapEditorValue(obj.soundId);
        if (typeof v === 'string' && v) {
            return (0, editorAsset_1.normalizeSoundId)(v);
        }
    }
    return '';
}
function readClipUuidFromListItem(item) {
    if (item == null || typeof item !== 'object') {
        return '';
    }
    const obj = item;
    if (!('audioFile' in obj)) {
        return '';
    }
    const audioFile = unwrapEditorValue(obj.audioFile);
    if (audioFile != null && typeof audioFile === 'object' && 'uuid' in audioFile) {
        return String(audioFile.uuid || '').trim();
    }
    return '';
}
function collectFromEditorList(listProp) {
    const list = unwrapEditorValue(listProp);
    if (!Array.isArray(list)) {
        return { soundIds: [], clipUuids: [] };
    }
    const soundIds = [];
    const clipUuids = [];
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
function isSoundPlayerComponent(comp) {
    var _a;
    const type = (_a = comp.type) !== null && _a !== void 0 ? _a : '';
    if (type === 'SoundPlayerModuleImpl' ||
        type === 'SlotSoundPlayerModule' ||
        type.startsWith('SlotSoundPlayerModule')) {
        return true;
    }
    return comp.value != null && 'sfxList' in comp.value;
}
function findSoundPlayerComp(node) {
    var _a, _b;
    const comps = (_a = node.__comps__) !== null && _a !== void 0 ? _a : [];
    return (_b = comps.find(isSoundPlayerComponent)) !== null && _b !== void 0 ? _b : null;
}
/**
 * Read sfxList / musicList from the editor scene dump (query-node).
 * Reliable in edit mode; matches what the Inspector shows.
 */
async function getSoundListKeysFromEditorDump(nodeUuid) {
    const node = (await Editor.Message.request('scene', 'query-node', nodeUuid));
    if (!node) {
        return null;
    }
    const soundComp = findSoundPlayerComp(node);
    if (!(soundComp === null || soundComp === void 0 ? void 0 : soundComp.value)) {
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
exports.getSoundListKeysFromEditorDump = getSoundListKeysFromEditorDump;
async function getExistingSfxKeysFromEditorDump(nodeUuid) {
    const node = (await Editor.Message.request('scene', 'query-node', nodeUuid));
    if (!node) {
        return null;
    }
    const soundComp = findSoundPlayerComp(node);
    if (!(soundComp === null || soundComp === void 0 ? void 0 : soundComp.value)) {
        return null;
    }
    const { soundIds, clipUuids } = collectFromEditorList(soundComp.value.sfxList);
    return {
        soundIds: new Set(soundIds),
        clipUuids: new Set(clipUuids),
    };
}
exports.getExistingSfxKeysFromEditorDump = getExistingSfxKeysFromEditorDump;
async function getSoundListKeysFromSceneScript(nodeUuid) {
    const raw = await Editor.Message.request('scene', 'execute-scene-script', {
        name: 'sound-setup',
        method: 'getSoundListKeys',
        args: [nodeUuid],
    });
    const data = (raw !== null && raw !== void 0 ? raw : {});
    return {
        sfxSoundIds: Array.isArray(data.sfxSoundIds)
            ? data.sfxSoundIds.map((id) => (0, editorAsset_1.normalizeSoundId)(id))
            : [],
        musicSoundIds: Array.isArray(data.musicSoundIds)
            ? data.musicSoundIds.map((id) => (0, editorAsset_1.normalizeSoundId)(id))
            : [],
        nodeName: data.nodeName,
    };
}
/** Editor dump first; scene script fallback for play-mode / edge cases. */
async function getSoundListKeysFromNode(nodeUuid) {
    const fromEditor = await getSoundListKeysFromEditorDump(nodeUuid);
    if ((fromEditor === null || fromEditor === void 0 ? void 0 : fromEditor.sfxSoundIds.length) || (fromEditor === null || fromEditor === void 0 ? void 0 : fromEditor.musicSoundIds.length)) {
        return fromEditor;
    }
    try {
        const fromScene = await getSoundListKeysFromSceneScript(nodeUuid);
        if (fromScene.sfxSoundIds.length || fromScene.musicSoundIds.length) {
            return fromScene;
        }
    }
    catch (_a) {
        /* scene script may be unavailable */
    }
    return (fromEditor !== null && fromEditor !== void 0 ? fromEditor : {
        sfxSoundIds: [],
        musicSoundIds: [],
    });
}
exports.getSoundListKeysFromNode = getSoundListKeysFromNode;
