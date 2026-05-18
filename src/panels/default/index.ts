import { readFileSync } from 'fs-extra';
import * as fs from 'fs-extra';
import { join } from 'path';
import {
    getConfigDbUrl,
    getConfigFsPath,
    getScriptsFsDir,
    queryAudioClipsInFolder,
} from '../../lib/editorAsset';
import { generateSoundConfigContent, writeSoundConfigFile } from '../../lib/soundConfigGenerator';
import {
    checkSoundConfigUsage,
    ConfigCheckResult,
    formatCheckResults,
} from '../../lib/soundConfigChecker';
import {
    formatNodeHint,
    getSelectedNodeUuid,
    querySceneNode,
} from '../../lib/sceneNode';
import { formatSetupSfxListHtml, setupSfxListOnNode } from '../../lib/setupSfxList';

function getInputValue(el: HTMLElement | null): string {
    return ((el as HTMLInputElement | null)?.value ?? '').trim();
}

function getCheckboxValue(el: HTMLElement | null): boolean {
    return (el as HTMLElement & { value?: boolean } | null)?.value !== false;
}

function formatCheckResultsHtml(results: ConfigCheckResult[]): string {
    const parts: string[] = ['<div class="section-title">=== Sound config usage ===</div>'];
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
        show() {},
        hide() {},
    },
    template: readFileSync(join(__dirname, '../../../static/template/default/index.html'), 'utf-8'),
    style: readFileSync(join(__dirname, '../../../static/style/default/index.css'), 'utf-8'),
    $: {
        gameID: '#gameID',
        folder: '#folder',
        soundNode: '#soundNode',
        soundNodeHint: '#soundNodeHint',
        sfxFolder: '#sfxFolder',
        bgmFolder: '#bgmFolder',
        preserveBgm: '#preserveBgm',
        btnPickNode: '#btnPickNode',
        btnSetupSfx: '#btnSetupSfx',
        btnGenerate: '#btnGenerate',
        btnCheck: '#btnCheck',
        btnClear: '#btnClear',
        results: '#results',
    },
    methods: {
        getSoundNodeUuid(this: any): string | undefined {
            return (this.$.soundNode as HTMLElement & { value?: string })?.value || undefined;
        },
        async refreshSoundNodeHint(this: any): Promise<void> {
            const hint = this.$.soundNodeHint as HTMLElement | null;
            if (!hint) {
                return;
            }
            const uuid = this.getSoundNodeUuid();
            if (!uuid) {
                hint.textContent = '';
                return;
            }
            const info = await querySceneNode(uuid);
            hint.textContent = info ? formatNodeHint(info) : uuid;
        },
        async pickSoundNodeFromSelection(this: any): Promise<void> {
            const uuid = getSelectedNodeUuid();
            if (!uuid) {
                this.logError('Select a node in the Hierarchy first.');
                return;
            }
            const el = this.$.soundNode as HTMLElement & { value?: string };
            if (el) {
                el.value = uuid;
            }
            await this.refreshSoundNodeHint();
        },
        logError(this: any, message: string) {
            this.$.results.innerHTML += `<div class="unused">${message}</div>`;
        },
        async setupSfxList(this: any) {
            const gameId = getInputValue(this.$.gameID);
            const nodeUuid = this.getSoundNodeUuid();
            const sfxFolderUuid = (this.$.sfxFolder as HTMLElement & { value?: string })?.value;

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
                const result = await setupSfxListOnNode(nodeUuid, sfxFolderUuid, gameId);
                this.$.results.innerHTML = formatSetupSfxListHtml(result);
                console.log('[sound-setup] Setup SFX list', result);
                for (const item of result.addedItems ?? []) {
                    console.log(`[sound-setup] + ${item.fileName} → ${item.soundId}`);
                }
                for (const item of result.skippedItems ?? []) {
                    const reason = item.reason ? ` (${item.reason})` : '';
                    console.log(`[sound-setup] − ${item.fileName} → ${item.soundId}${reason}`);
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                this.logError(`Setup SFX list failed: ${message}`);
                console.error('[sound-setup] setup SFX list failed', err);
            }
        },
        async generateConfig(this: any) {
            const gameId = getInputValue(this.$.gameID);
            const projectPath = getInputValue(this.$.folder);
            const sfxUuid = (this.$.sfxFolder as HTMLElement & { value?: string })?.value;
            const bgmUuid = (this.$.bgmFolder as HTMLElement & { value?: string })?.value;
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
                const sfxClips = await queryAudioClipsInFolder(sfxUuid);
                const bgmClips = bgmUuid ? await queryAudioClipsInFolder(bgmUuid) : [];

                if (!sfxClips.length) {
                    this.$.results.innerHTML = '<div class="warn">No mp3 AudioClip assets found in SFX folder.</div>';
                }

                const configFsPath = getConfigFsPath(projectPath, gameId);
                const existingContent = (await fs.pathExists(configFsPath))
                    ? await fs.readFile(configFsPath, 'utf-8')
                    : undefined;

                const content = generateSoundConfigContent({
                    gameId,
                    sfxFiles: sfxClips.map((c) => c.name),
                    bgmFiles: bgmClips.map((c) => c.name),
                    preserveBgm,
                    existingContent,
                });

                await writeSoundConfigFile(configFsPath, content);

                const dbUrl = getConfigDbUrl(projectPath, gameId);
                await Editor.Message.request('asset-db', 'refresh-asset', dbUrl);

                this.$.results.innerHTML =
                    `<div class="ok">Generated ${configFsPath}</div>` +
                    `<div class="info">SFX keys: ${sfxClips.length}, BGM keys: ${bgmClips.length}</div>`;
                console.log('[sound-setup] Generated SoundConfig', configFsPath);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                this.logError(`Generate failed: ${message}`);
                console.error('[sound-setup] generate failed', err);
            }
        },
        async checkUsage(this: any) {
            const gameId = getInputValue(this.$.gameID);
            const projectPath = getInputValue(this.$.folder);

            if (!gameId || !projectPath) {
                this.logError('Game ID and project path are required.');
                return;
            }

            const configFsPath = getConfigFsPath(projectPath, gameId);
            const scriptsDir = getScriptsFsDir(projectPath);

            if (!(await fs.pathExists(configFsPath))) {
                this.logError(`Config not found: ${configFsPath}`);
                return;
            }

            try {
                const results = await checkSoundConfigUsage(configFsPath, scriptsDir);
                this.$.results.innerHTML = formatCheckResultsHtml(results);
                console.log('[sound-setup] Check usage\n', formatCheckResults(results));
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                this.logError(`Check failed: ${message}`);
                console.error('[sound-setup] check failed', err);
            }
        },
        clearResults(this: any) {
            this.$.results.innerHTML = '<span class="info">Cleared.</span>';
        },
    },
    ready() {
        const $ = this.$;
        $.btnSetupSfx?.addEventListener('confirm', () => this.setupSfxList());
        $.btnGenerate?.addEventListener('confirm', () => this.generateConfig());
        $.btnCheck?.addEventListener('confirm', () => this.checkUsage());
        $.btnClear?.addEventListener('confirm', () => this.clearResults());
        $.btnPickNode?.addEventListener('confirm', () => this.pickSoundNodeFromSelection());
        $.soundNode?.addEventListener('change', () => this.refreshSoundNodeHint());
        $.soundNode?.addEventListener('confirm', () => this.refreshSoundNodeHint());
        if ($.results) {
            $.results.innerHTML = '<span class="info">Select folders and run Generate or Check usage.</span>';
        }
        void this.refreshSoundNodeHint();
    },
    beforeClose() {},
    close() {},
});
