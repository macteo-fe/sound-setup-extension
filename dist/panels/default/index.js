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
const fs_extra_1 = require("fs-extra");
const fs = __importStar(require("fs-extra"));
const path_1 = require("path");
const editorAsset_1 = require("../../lib/editorAsset");
const soundConfigGenerator_1 = require("../../lib/soundConfigGenerator");
const soundConfigChecker_1 = require("../../lib/soundConfigChecker");
function getInputValue(el) {
    var _a;
    return ((_a = el === null || el === void 0 ? void 0 : el.value) !== null && _a !== void 0 ? _a : '').trim();
}
function getCheckboxValue(el) {
    return (el === null || el === void 0 ? void 0 : el.value) !== false;
}
function formatCheckResultsHtml(results) {
    const parts = ['<div class="section-title">=== Sound config usage ===</div>'];
    for (const { objectName, used, unused } of results) {
        parts.push(`<div class="section-title">--- ${objectName} ---</div>`);
        for (const key of used) {
            parts.push(`<div class="ok">✅ ${objectName}.${key}</div>`);
        }
        for (const key of unused) {
            parts.push(`<div class="unused">❌ ${objectName}.${key}</div>`);
        }
        parts.push(`<div class="info">${used.length} used, ${unused.length} unused</div>`);
    }
    return parts.join('');
}
module.exports = Editor.Panel.define({
    listeners: {
        show() { },
        hide() { },
    },
    template: (0, fs_extra_1.readFileSync)((0, path_1.join)(__dirname, '../../../static/template/default/index.html'), 'utf-8'),
    style: (0, fs_extra_1.readFileSync)((0, path_1.join)(__dirname, '../../../static/style/default/index.css'), 'utf-8'),
    $: {
        gameID: '#gameID',
        folder: '#folder',
        sfxFolder: '#sfxFolder',
        bgmFolder: '#bgmFolder',
        preserveBgm: '#preserveBgm',
        btnGenerate: '#btnGenerate',
        btnCheck: '#btnCheck',
        btnClear: '#btnClear',
        results: '#results',
    },
    methods: {
        logError(message) {
            this.$.results.innerHTML += `<div class="unused">${message}</div>`;
        },
        async generateConfig() {
            var _a, _b;
            const gameId = getInputValue(this.$.gameID);
            const projectPath = getInputValue(this.$.folder);
            const sfxUuid = (_a = this.$.sfxFolder) === null || _a === void 0 ? void 0 : _a.value;
            const bgmUuid = (_b = this.$.bgmFolder) === null || _b === void 0 ? void 0 : _b.value;
            const preserveBgm = getCheckboxValue(this.$.preserveBgm);
            if (!gameId || !projectPath) {
                this.logError('Game ID and project path are required.');
                return;
            }
            if (!sfxUuid) {
                this.logError('Select an SFX folder with mp3 files.');
                return;
            }
            try {
                const sfxClips = await (0, editorAsset_1.queryAudioClipsInFolder)(sfxUuid);
                const bgmClips = bgmUuid ? await (0, editorAsset_1.queryAudioClipsInFolder)(bgmUuid) : [];
                if (!sfxClips.length) {
                    this.$.results.innerHTML = '<div class="warn">No mp3 AudioClip assets found in SFX folder.</div>';
                }
                const configFsPath = (0, editorAsset_1.getConfigFsPath)(projectPath, gameId);
                const existingContent = (await fs.pathExists(configFsPath))
                    ? await fs.readFile(configFsPath, 'utf-8')
                    : undefined;
                const content = (0, soundConfigGenerator_1.generateSoundConfigContent)({
                    gameId,
                    sfxFiles: sfxClips.map((c) => c.name),
                    bgmFiles: bgmClips.map((c) => c.name),
                    preserveBgm,
                    existingContent,
                });
                await (0, soundConfigGenerator_1.writeSoundConfigFile)(configFsPath, content);
                const dbUrl = (0, editorAsset_1.getConfigDbUrl)(projectPath, gameId);
                await Editor.Message.request('asset-db', 'refresh-asset', dbUrl);
                this.$.results.innerHTML =
                    `<div class="ok">Generated ${configFsPath}</div>` +
                        `<div class="info">SFX keys: ${sfxClips.length}, BGM keys: ${bgmClips.length}</div>`;
                console.log('[sound-setup] Generated SoundConfig', configFsPath);
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
            if (!gameId || !projectPath) {
                this.logError('Game ID and project path are required.');
                return;
            }
            const configFsPath = (0, editorAsset_1.getConfigFsPath)(projectPath, gameId);
            const scriptsDir = (0, editorAsset_1.getScriptsFsDir)(projectPath);
            if (!(await fs.pathExists(configFsPath))) {
                this.logError(`Config not found: ${configFsPath}`);
                return;
            }
            try {
                const results = await (0, soundConfigChecker_1.checkSoundConfigUsage)(configFsPath, scriptsDir);
                this.$.results.innerHTML = formatCheckResultsHtml(results);
                console.log('[sound-setup] Check usage\n', (0, soundConfigChecker_1.formatCheckResults)(results));
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
        var _a, _b, _c;
        const $ = this.$;
        (_a = $.btnGenerate) === null || _a === void 0 ? void 0 : _a.addEventListener('confirm', () => this.generateConfig());
        (_b = $.btnCheck) === null || _b === void 0 ? void 0 : _b.addEventListener('confirm', () => this.checkUsage());
        (_c = $.btnClear) === null || _c === void 0 ? void 0 : _c.addEventListener('confirm', () => this.clearResults());
        if ($.results) {
            $.results.innerHTML = '<span class="info">Select folders and run Generate or Check usage.</span>';
        }
    },
    beforeClose() { },
    close() { },
});
