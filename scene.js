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

function isSoundPlayerClassName(name) {
    if (!name) {
        return false;
    }
    if (SOUND_PLAYER_CLASS_NAMES.includes(name)) {
        return true;
    }
    return name.startsWith('SlotSoundPlayerModule');
}

function getSoundPlayerComponentOnNode(node) {
    const components = node.components || [];
    for (const comp of components) {
        const name = js.getClassName(comp.constructor);
        if (isSoundPlayerClassName(name)) {
            return comp;
        }
    }
    return null;
}

function getSoundPlayerComponent(node) {
    const onSelf = getSoundPlayerComponentOnNode(node);
    if (onSelf) {
        return onSelf;
    }
    const stack = [...(node.children || [])];
    while (stack.length) {
        const child = stack.pop();
        const comp = getSoundPlayerComponentOnNode(child);
        if (comp) {
            return comp;
        }
        if (child.children?.length) {
            stack.push(...child.children);
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

function normalizeSoundId(id) {
    return String(id || '').replace(/\s+/g, '').toUpperCase();
}

function getAudioClipUuid(audioFile) {
    if (!audioFile) {
        return '';
    }
    return String(audioFile._uuid || audioFile.uuid || '').trim();
}

function collectSoundIdsFromList(list) {
    const ids = [];
    for (const item of list || []) {
        const soundId = normalizeSoundId(item.soundId);
        if (soundId) {
            ids.push(soundId);
        }
    }
    return ids;
}

function collectExistingSfxKeys(existingList) {
    const soundIds = new Set();
    const clipUuids = new Set();

    for (const item of existingList) {
        const soundId = normalizeSoundId(item.soundId);
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

function resolveSoundPlayerOnNode(nodeUuid) {
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

    return { node, soundComp };
}

function collectSoundPlayerNodes(scene) {
    const matches = [];
    function pushIfSoundPlayer(n) {
        if (!n) {
            return;
        }
        if (getSoundPlayerComponentOnNode(n)) {
            matches.push({ uuid: n.uuid, name: n.name || '' });
        }
    }
    if (!scene) {
        return matches;
    }
    if (typeof scene.walk === 'function') {
        scene.walk((n) => pushIfSoundPlayer(n));
    } else {
        const stack = [scene];
        while (stack.length) {
            const n = stack.pop();
            pushIfSoundPlayer(n);
            const children = (n && n.children) || [];
            for (let i = children.length - 1; i >= 0; i--) {
                stack.push(children[i]);
            }
        }
    }
    return matches;
}

function pickBestSoundPlayerMatch(matches) {
    if (!matches.length) {
        return null;
    }
    const lower = (s) => String(s || '').toLowerCase().trim();
    let hit = matches.find((m) => lower(m.name) === 'slotsoundplayer');
    if (hit) {
        return hit;
    }
    hit = matches.find((m) => lower(m.name).includes('soundplayer'));
    if (hit) {
        return hit;
    }
    hit = matches.find((m) => lower(m.name).includes('sound'));
    if (hit) {
        return hit;
    }
    return matches[0];
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
     * @returns {{ uuid: string, name: string }}
     */
    getOpenSceneInfo() {
        const scene = director.getScene();
        if (!scene) {
            return { uuid: '', name: '' };
        }
        return { uuid: scene.uuid || '', name: scene.name || '' };
    },

    /**
     * First node in the loaded scene that has SoundPlayerModuleImpl / SlotSoundPlayerModule*.
     * Prefers name `SlotSoundPlayer`, then names containing `soundplayer` / `sound`.
     * @returns {{ uuid: string, name: string, candidateCount: number } | null}
     */
    findSoundPlayerNodeUuid() {
        const scene = director.getScene();
        if (!scene) {
            return null;
        }
        const matches = collectSoundPlayerNodes(scene);
        const picked = pickBestSoundPlayerMatch(matches);
        if (!picked) {
            return null;
        }
        return {
            uuid: picked.uuid,
            name: picked.name,
            candidateCount: matches.length,
        };
    },

    /**
     * @param {string} nodeUuid
     * @returns {{ sfxSoundIds: string[], musicSoundIds: string[], nodeName: string }}
     */
    getSoundListKeys(nodeUuid) {
        const { node, soundComp } = resolveSoundPlayerOnNode(nodeUuid);
        const sfxList = Array.isArray(soundComp.sfxList) ? soundComp.sfxList : [];
        const musicList = Array.isArray(soundComp.musicList) ? soundComp.musicList : [];
        return {
            sfxSoundIds: collectSoundIdsFromList(sfxList),
            musicSoundIds: collectSoundIdsFromList(musicList),
            nodeName: node.name,
        };
    },

    /**
     * @param {string} nodeUuid
     * @returns {{ soundIds: string[], clipUuids: string[] }}
     */
    getExistingSfxKeys(nodeUuid) {
        const { soundComp } = resolveSoundPlayerOnNode(nodeUuid);
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
        const { node, soundComp } = resolveSoundPlayerOnNode(nodeUuid);

        const CustomAudioClipModuleKlass = getClass('CustomAudioClipModule');
        const existingList = Array.isArray(soundComp.sfxList) ? [...soundComp.sfxList] : [];
        const { soundIds, clipUuids } = collectExistingSfxKeys(existingList);

        let added = 0;
        let skipped = 0;
        const addedItems = [];
        const skippedItems = [];

        for (const entry of entries || []) {
            const soundId = normalizeSoundId(entry.soundId);
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
