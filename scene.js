/* eslint-disable @typescript-eslint/explicit-function-return-type */
const { director, Node, Component, js, assetManager } = require('cc');

const SOUND_PLAYER_CLASS_NAMES = [
    'SoundPlayerModuleImpl',
    'SlotSoundPlayerModule',
];

function findNodeByUuid(scene, uuid) {
    let found = null;
    if (!scene) {
        return null;
    }
    if (typeof scene.walk === 'function') {
        scene.walk((n) => {
            if (n && n.uuid === uuid) {
                found = n;
            }
        });
    } else {
        const stack = [scene];
        while (stack.length && !found) {
            const n = stack.pop();
            if (n && n.uuid === uuid) {
                found = n;
                break;
            }
            const children = (n && n.children) || [];
            for (let i = 0; i < children.length; i++) {
                stack.push(children[i]);
            }
        }
    }
    return found;
}

function getSoundPlayerComponent(node) {
    const components = node.components || [];
    for (const comp of components) {
        const name = js.getClassName(comp.constructor);
        if (SOUND_PLAYER_CLASS_NAMES.includes(name)) {
            return comp;
        }
        if (name && name.startsWith('SlotSoundPlayerModule')) {
            return comp;
        }
    }
    return null;
}

function getClass(name) {
    const K = cc.js.getClassByName(name);
    if (!K) {
        throw new Error(`Class not found (runtime name): ${name}`);
    }
    return K;
}

async function loadAudioClipByUuid(uuid) {
    const cached = assetManager.assets.get(uuid);
    if (cached) {
        return cached;
    }
    return new Promise((resolve, reject) => {
        assetManager.loadAny({ uuid }, (err, asset) => {
            if (err) {
                return reject(err);
            }
            resolve(asset);
        });
    });
}

function getAudioClipUuid(audioFile) {
    if (!audioFile) {
        return '';
    }
    return String(audioFile._uuid || audioFile.uuid || '').trim();
}

function collectExistingSfxKeys(existingList) {
    const soundIds = new Set();
    const clipUuids = new Set();

    for (const item of existingList) {
        const soundId = String(item.soundId || '').toUpperCase();
        if (soundId) {
            soundIds.add(soundId);
        }
        const clipUuid = getAudioClipUuid(item.audioFile);
        if (clipUuid) {
            clipUuids.add(clipUuid);
        }
    }

    return { soundIds, clipUuids };
}

function getSkipReason(soundId, clipUuid, soundIds, clipUuids) {
    const duplicateSoundId = soundIds.has(soundId);
    const duplicateClip = clipUuids.has(clipUuid);
    if (duplicateSoundId && duplicateClip) {
        return 'duplicate soundId and audioFile';
    }
    if (duplicateSoundId) {
        return 'duplicate soundId';
    }
    if (duplicateClip) {
        return 'duplicate audioFile';
    }
    return '';
}

exports.methods = {
    /**
     * @param {string} nodeUuid
     * @returns {{ soundIds: string[], clipUuids: string[] }}
     */
    getExistingSfxKeys(nodeUuid) {
        const scene = director.getScene();
        if (!scene) {
            throw new Error('No active scene');
        }

        const node = findNodeByUuid(scene, nodeUuid);
        if (!node) {
            throw new Error(`Node not found: ${nodeUuid}`);
        }

        const soundComp = getSoundPlayerComponent(node);
        if (!soundComp) {
            throw new Error('SoundPlayerModuleImpl (or subclass) not found on node');
        }

        const existingList = Array.isArray(soundComp.sfxList) ? soundComp.sfxList : [];
        const { soundIds, clipUuids } = collectExistingSfxKeys(existingList);
        return {
            soundIds: [...soundIds],
            clipUuids: [...clipUuids],
        };
    },

    /**
     * @param {string} nodeUuid
     * @param {{ soundId: string, clipUuid: string, fileName?: string }[]} entries
     */
    async setupSfxList(nodeUuid, entries) {
        const scene = director.getScene();
        if (!scene) {
            throw new Error('No active scene');
        }

        const node = findNodeByUuid(scene, nodeUuid);
        if (!node) {
            throw new Error(`Node not found: ${nodeUuid}`);
        }

        const soundComp = getSoundPlayerComponent(node);
        if (!soundComp) {
            throw new Error('SoundPlayerModuleImpl (or subclass) not found on node');
        }

        const CustomAudioClipModuleKlass = getClass('CustomAudioClipModule');
        const existingList = Array.isArray(soundComp.sfxList) ? [...soundComp.sfxList] : [];
        const { soundIds, clipUuids } = collectExistingSfxKeys(existingList);

        let added = 0;
        let skipped = 0;
        const addedItems = [];
        const skippedItems = [];

        for (const entry of entries || []) {
            const soundId = String(entry.soundId || '').toUpperCase();
            const clipUuid = String(entry.clipUuid || '').trim();
            const fileName = String(entry.fileName || entry.file || soundId);
            if (!soundId || !clipUuid) {
                continue;
            }

            const skipReason = getSkipReason(soundId, clipUuid, soundIds, clipUuids);
            if (skipReason) {
                skipped += 1;
                skippedItems.push({ fileName, soundId, reason: skipReason });
                continue;
            }

            const clip = await loadAudioClipByUuid(clipUuid);
            const mod = new CustomAudioClipModuleKlass();
            mod.isEffect = true;
            mod.soundId = soundId;
            mod.audioFile = clip;
            existingList.push(mod);
            soundIds.add(soundId);
            clipUuids.add(clipUuid);
            added += 1;
            addedItems.push({ fileName, soundId });
        }

        soundComp.sfxList = existingList;

        return {
            added,
            skipped,
            total: existingList.length,
            nodeName: node.name,
            addedItems,
            skippedItems,
        };
    },
};
