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
        sfxFolder: '#sfxFolder',
        bgmFolder: '#bgmFolder',
        preserveBgm: '#preserveBgm',
        btnGenerate: '#btnGenerate',
        btnCheck: '#btnCheck',
        btnClear: '#btnClear',
        results: '#results',
    },
    methods: {
        logError(this: any, message: string) {
            this.$.results.innerHTML += `<div class="unused">${message}</div>`;
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
        $.btnGenerate?.addEventListener('confirm', () => this.generateConfig());
        $.btnCheck?.addEventListener('confirm', () => this.checkUsage());
        $.btnClear?.addEventListener('confirm', () => this.clearResults());
        if ($.results) {
            $.results.innerHTML = '<span class="info">Select folders and run Generate or Check usage.</span>';
        }
    },
    beforeClose() {},
    close() {},
});
