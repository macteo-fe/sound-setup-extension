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

exports.methods = {
    /**
     * @param {string} nodeUuid
     * @returns {string[]}
     */
    getExistingSfxSoundIds(nodeUuid) {
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
        return existingList
            .map((m) => String(m.soundId || '').toUpperCase())
            .filter(Boolean);
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
        const existingIds = new Set(
            existingList.map((m) => String(m.soundId || '').toUpperCase()).filter(Boolean),
        );

        let added = 0;
        let skipped = 0;
        const addedItems = [];
        const skippedItems = [];

        for (const entry of entries || []) {
            const soundId = String(entry.soundId || '').toUpperCase();
            const fileName = String(entry.fileName || entry.file || soundId);
            if (!soundId || !entry.clipUuid) {
                continue;
            }
            if (existingIds.has(soundId)) {
                skipped += 1;
                skippedItems.push({ fileName, soundId });
                continue;
            }

            const clip = await loadAudioClipByUuid(entry.clipUuid);
            const mod = new CustomAudioClipModuleKlass();
            mod.isEffect = true;
            mod.soundId = soundId;
            mod.audioFile = clip;
            existingList.push(mod);
            existingIds.add(soundId);
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
