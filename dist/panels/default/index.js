"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable @typescript-eslint/explicit-function-return-type */
const fs = __importStar(require("fs-extra"));
const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
const editorAsset_1 = require("../../lib/editorAsset");
const openSceneContext_1 = require("../../lib/openSceneContext");
const sceneNode_1 = require("../../lib/sceneNode");
const setupSfxList_1 = require("../../lib/setupSfxList");
const soundConfigChecker_1 = require("../../lib/soundConfigChecker");
const soundConfigGenerator_1 = require("../../lib/soundConfigGenerator");
function getInputValue(el) {
    var _a;
    return ((_a = el === null || el === void 0 ? void 0 : el.value) !== null && _a !== void 0 ? _a : '').trim();
}
function getCheckboxValue(el) {
    return (el === null || el === void 0 ? void 0 : el.value) !== false;
}
function setInputValue(el, value) {
    if (!el) {
        return;
    }
    el.value = value;
}
function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function formatCheckResultsHtml(results) {
    const parts = ['<div class="section-title">=== Sound usage (from sound node) ===</div>'];
    for (const { objectName, used, usedInCode, usedOnSceneOnly, unusedNotInScene } of results) {
        parts.push(`<div class="section-title">--- ${objectName} ---</div>`);
        const sceneOnly = new Set(usedOnSceneOnly.map((e) => e.key));
        const sceneOnlyByKey = new Map(usedOnSceneOnly.map((e) => [e.key, e.paths]));
        const codeByKey = new Map(usedInCode.map((e) => [e.key, e]));
        for (const key of used) {
            if (sceneOnly.has(key)) {
                parts.push(`<div class="ok">✅ ${escapeHtml(key)} — on scene</div>`);
                for (const p of sceneOnlyByKey.get(key) || []) {
                    parts.push(`<div class="used-scene-path">${escapeHtml(p)}</div>`);
                }
            }
            else {
                const entry = codeByKey.get(key);
                const dynamicOnly = entry === null || entry === void 0 ? void 0 : entry.dynamicOnly;
                const rowClass = dynamicOnly ? 'warn' : 'ok';
                const marker = dynamicOnly ? '⚠️' : '✅';
                const suffix = dynamicOnly ? ' — dynamic (may not cover all variants)' : '';
                parts.push(`<div class="${rowClass}">${marker} ${escapeHtml(key)}${escapeHtml(suffix)}</div>`);
                for (const file of (entry === null || entry === void 0 ? void 0 : entry.files) || []) {
                    parts.push(`<div class="used-code-path">${escapeHtml(file)}</div>`);
                }
            }
        }
        for (const key of unusedNotInScene) {
            parts.push(`<div class="unused">❌ ${escapeHtml(key)}</div>`);
        }
        parts.push(`<div class="info">${used.length} used (${usedInCode.length} in code, ${usedOnSceneOnly.length} on scene) · ${unusedNotInScene.length} unused</div>`);
    }
    const summary = (0, soundConfigChecker_1.summarizeCheckResults)(results);
    if (summary.total > 0) {
        parts.push(`<div class="section-title">Total: ${summary.used} / ${summary.total} used</div>`);
        const dynamicPart = summary.usedDynamicInCode > 0
            ? ` · ${summary.usedDynamicInCode} dynamic in code`
            : '';
        parts.push(`<div class="info">${summary.usedInCode} in code${dynamicPart} · ${summary.usedOnSceneOnly} on scene · ${summary.unused} unused</div>`);
    }
    return parts.join('');
}
function logCheckResultsToConsole(results) {
    console.log('[sound-setup] Check usage\n', (0, soundConfigChecker_1.formatCheckResults)(results));
}
module.exports = Editor.Panel.define({
    listeners: {
        show() {
            void this.syncFromOpenScene();
        },
        hide() { },
    },
    template: (0, fs_extra_1.readFileSync)((0, path_1.join)(__dirname, '../../../static/template/default/index.html'), 'utf-8'),
    style: (0, fs_extra_1.readFileSync)((0, path_1.join)(__dirname, '../../../static/style/default/index.css'), 'utf-8'),
    $: {
        gameID: '#gameID',
        folder: '#folder',
        soundNode: '#soundNode',
        soundNodeHint: '#soundNodeHint',
        sceneDetectHint: '#sceneDetectHint',
        btnSyncScene: '#btnSyncScene',
        sfxFolder: '#sfxFolder',
        preserveBgm: '#preserveBgm',
        btnPickNode: '#btnPickNode',
        btnAutoSoundNode: '#btnAutoSoundNode',
        btnSetupSfx: '#btnSetupSfx',
        btnGenerate: '#btnGenerate',
        btnCheck: '#btnCheck',
        btnClear: '#btnClear',
        results: '#results',
    },
    methods: {
        getSoundNodeUuid() {
            var _a;
            return ((_a = this.$.soundNode) === null || _a === void 0 ? void 0 : _a.value) || undefined;
        },
        async syncFromOpenScene() {
            await this.applyOpenSceneContext();
            await this.autoPickSoundNode({ force: false });
        },
        async applyOpenSceneContext() {
            const hint = this.$.sceneDetectHint;
            try {
                const ctx = await (0, openSceneContext_1.detectGameContextFromOpenScene)();
                if (!ctx) {
                    if (hint) {
                        hint.textContent = 'No open scene detected (open a .scene under assets/).';
                    }
                    return false;
                }
                setInputValue(this.$.gameID, ctx.gameId);
                setInputValue(this.$.folder, ctx.projectPath);
                if (hint) {
                    hint.textContent = (0, openSceneContext_1.formatSceneContextHint)(ctx);
                }
                console.log('[sound-setup] Detected from open scene', ctx);
                return true;
            }
            catch (err) {
                if (hint) {
                    hint.textContent = '';
                }
                console.warn('[sound-setup] scene context detection failed', err);
                return false;
            }
        },
        async refreshSoundNodeHint() {
            const hint = this.$.soundNodeHint;
            if (!hint) {
                return;
            }
            const uuid = this.getSoundNodeUuid();
            if (!uuid) {
                hint.textContent = '';
                return;
            }
            const info = await (0, sceneNode_1.querySceneNode)(uuid);
            hint.textContent = info ? (0, sceneNode_1.formatNodeHint)(info) : uuid;
        },
        async pickSoundNodeFromSelection() {
            const uuid = (0, sceneNode_1.getSelectedNodeUuid)();
            if (!uuid) {
                this.logError('Select a node in the Hierarchy first.');
                return;
            }
            const el = this.$.soundNode;
            if (el) {
                el.value = uuid;
            }
            await this.refreshSoundNodeHint();
        },
        /** Resolve Sound node from the active scene (SoundPlayerModuleImpl / SlotSoundPlayerModule*). */
        async autoPickSoundNode(opts) {
            var _a;
            const force = (_a = opts === null || opts === void 0 ? void 0 : opts.force) !== null && _a !== void 0 ? _a : false;
            if (!force && this.getSoundNodeUuid()) {
                return false;
            }
            try {
                const found = await (0, sceneNode_1.findSoundPlayerNodeInOpenScene)();
                if (!found) {
                    if (force) {
                        this.logError('No SoundPlayer node found in the open scene.');
                    }
                    return false;
                }
                const el = this.$.soundNode;
                if (el) {
                    el.value = found.uuid;
                }
                await this.refreshSoundNodeHint();
                const extra = found.candidateCount > 1
                    ? ` (${found.candidateCount} candidates; picked best match by node name)`
                    : '';
                console.log(`[sound-setup] Auto Sound node: ${found.name} (${found.uuid})${extra}`);
                return true;
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.warn('[sound-setup] auto pick Sound node failed', err);
                if (force) {
                    this.logError(`Auto Sound node failed: ${message}`);
                }
                return false;
            }
        },
        logError(message) {
            this.$.results.innerHTML += `<div class="unused">${message}</div>`;
        },
        async setupSfxList() {
            var _a, _b, _c;
            const gameId = getInputValue(this.$.gameID);
            const nodeUuid = this.getSoundNodeUuid();
            const sfxFolderUuid = (_a = this.$.sfxFolder) === null || _a === void 0 ? void 0 : _a.value;
            if (!gameId) {
                this.logError('Game ID is required for sound id naming.');
                return;
            }
            if (!nodeUuid) {
                this.logError('Assign a sound node with SoundPlayerModuleImpl.');
                return;
            }
            if (!sfxFolderUuid) {
                this.logError('Select an SFX folder with mp3 files.');
                return;
            }
            try {
                const result = await (0, setupSfxList_1.setupSfxListOnNode)(nodeUuid, sfxFolderUuid, gameId);
                this.$.results.innerHTML = (0, setupSfxList_1.formatSetupSfxListHtml)(result);
                console.log('[sound-setup] Setup SFX list', result);
                for (const item of (_b = result.addedItems) !== null && _b !== void 0 ? _b : []) {
                    console.log(`[sound-setup] + ${item.fileName} → ${item.soundId}`);
                }
                for (const item of (_c = result.skippedItems) !== null && _c !== void 0 ? _c : []) {
                    const reason = item.reason ? ` (${item.reason})` : '';
                    console.log(`[sound-setup] − ${item.fileName} → ${item.soundId}${reason}`);
                }
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                this.logError(`Setup SFX list failed: ${message}`);
                console.error('[sound-setup] setup SFX list failed', err);
            }
        },
        async generateConfig() {
            const gameId = getInputValue(this.$.gameID);
            const projectPath = getInputValue(this.$.folder);
            const nodeUuid = this.getSoundNodeUuid();
            const preserveBgm = getCheckboxValue(this.$.preserveBgm);
            if (!gameId || !projectPath) {
                this.logError('Game ID and project path are required.');
                return;
            }
            if (!nodeUuid) {
                this.logError('Assign a sound node with sfxList.');
                return;
            }
            try {
                const lists = await (0, soundConfigGenerator_1.getSoundListKeysFromNode)(nodeUuid);
                if (!lists.sfxSoundIds.length) {
                    this.logError('sfxList is empty on the sound node. Run Setup SFX list first.');
                    return;
                }
                const configFsPath = (0, editorAsset_1.getConfigFsPath)(projectPath, gameId);
                const existingContent = (await fs.pathExists(configFsPath))
                    ? await fs.readFile(configFsPath, 'utf-8')
                    : undefined;
                const generated = (0, soundConfigGenerator_1.generateSoundConfigContent)({
                    sfxSoundIds: lists.sfxSoundIds,
                    musicSoundIds: lists.musicSoundIds,
                    preserveBgm,
                    existingContent,
                });
                await (0, soundConfigGenerator_1.writeSoundConfigFile)(configFsPath, generated.content);
                const dbUrl = (0, editorAsset_1.getConfigDbUrl)(projectPath, gameId);
                await Editor.Message.request('asset-db', 'refresh-asset', dbUrl);
                this.$.results.innerHTML = (0, soundConfigGenerator_1.formatGenerateConfigHtml)(configFsPath, lists, preserveBgm, generated);
                console.log('[sound-setup] Generated SoundConfig from sfxList', lists);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                this.logError(`Generate failed: ${message}`);
                console.error('[sound-setup] generate failed', err);
            }
        },
        async checkUsage() {
            const gameId = getInputValue(this.$.gameID);
            const projectPath = getInputValue(this.$.folder);
            const nodeUuid = this.getSoundNodeUuid();
            if (!gameId || !projectPath) {
                this.logError('Game ID and project path are required.');
                return;
            }
            if (!nodeUuid) {
                this.logError('Assign a sound node with sfxList / musicList.');
                return;
            }
            const scriptsDir = (0, editorAsset_1.getScriptsFsDir)(projectPath);
            const configFsPath = (0, editorAsset_1.getConfigFsPath)(projectPath, gameId);
            const configExists = await fs.pathExists(configFsPath);
            try {
                this.$.results.innerHTML = '<span class="info">Checking usage…</span>';
                const lists = await (0, soundConfigGenerator_1.getSoundListKeysFromNode)(nodeUuid);
                if (!lists.sfxSoundIds.length && !lists.musicSoundIds.length) {
                    this.logError('sfxList and musicList are empty on the sound node.');
                    return;
                }
                const results = await (0, soundConfigChecker_1.checkSoundUsage)({
                    scriptsDir,
                    sfxSoundIds: lists.sfxSoundIds,
                    musicSoundIds: lists.musicSoundIds,
                    configFsPath: configExists ? configFsPath : undefined,
                });
                this.$.results.innerHTML = formatCheckResultsHtml(results);
                logCheckResultsToConsole(results);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                this.logError(`Check failed: ${message}`);
                console.error('[sound-setup] check failed', err);
            }
        },
        clearResults() {
            this.$.results.innerHTML = '<span class="info">Cleared.</span>';
        },
    },
    ready() {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const $ = this.$;
        const panel = this;
        const onSceneReady = () => {
            void panel.syncFromOpenScene();
        };
        panel._onSceneReady = onSceneReady;
        (_a = $.btnSetupSfx) === null || _a === void 0 ? void 0 : _a.addEventListener('confirm', () => this.setupSfxList());
        (_b = $.btnGenerate) === null || _b === void 0 ? void 0 : _b.addEventListener('confirm', () => this.generateConfig());
        (_c = $.btnCheck) === null || _c === void 0 ? void 0 : _c.addEventListener('confirm', () => this.checkUsage());
        (_d = $.btnClear) === null || _d === void 0 ? void 0 : _d.addEventListener('confirm', () => this.clearResults());
        (_e = $.btnPickNode) === null || _e === void 0 ? void 0 : _e.addEventListener('confirm', () => this.pickSoundNodeFromSelection());
        (_f = $.btnAutoSoundNode) === null || _f === void 0 ? void 0 : _f.addEventListener('confirm', () => this.autoPickSoundNode({ force: true }));
        (_g = $.btnSyncScene) === null || _g === void 0 ? void 0 : _g.addEventListener('confirm', () => this.syncFromOpenScene());
        (_h = $.soundNode) === null || _h === void 0 ? void 0 : _h.addEventListener('change', () => this.refreshSoundNodeHint());
        (_j = $.soundNode) === null || _j === void 0 ? void 0 : _j.addEventListener('confirm', () => this.refreshSoundNodeHint());
        if ($.results) {
            $.results.innerHTML = '<span class="info">Open a game scene to auto-fill Game ID and Project path.</span>';
            const allowTextSelection = (event) => event.stopPropagation();
            $.results.addEventListener('mousedown', allowTextSelection);
            $.results.addEventListener('pointerdown', allowTextSelection);
            panel._onResultsSelect = allowTextSelection;
        }
        Editor.Message.addBroadcastListener('scene:ready', onSceneReady);
        void panel.syncFromOpenScene();
    },
    beforeClose() {
        const panel = this;
        if (panel._onSceneReady) {
            Editor.Message.removeBroadcastListener('scene:ready', panel._onSceneReady);
            panel._onSceneReady = null;
        }
        if (panel._onResultsSelect && panel.$.results) {
            panel.$.results.removeEventListener('mousedown', panel._onResultsSelect);
            panel.$.results.removeEventListener('pointerdown', panel._onResultsSelect);
            panel._onResultsSelect = null;
        }
    },
    close() { },
});
