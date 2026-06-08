/* eslint-disable @typescript-eslint/explicit-function-return-type */
import * as fs from 'fs-extra';
import { readFileSync } from 'fs-extra';
import { join } from 'path';
import {
    getConfigDbUrl,
    getConfigFsPath,
    getScriptsFsDir
} from '../../lib/editorAsset';
import {
    detectGameContextFromOpenScene,
    formatSceneContextHint,
} from '../../lib/openSceneContext';
import {
    findSoundPlayerNodeInOpenScene,
    formatNodeHint,
    getSelectedNodeUuid,
    querySceneNode,
} from '../../lib/sceneNode';
import { formatSetupSfxListHtml, setupSfxListOnNode } from '../../lib/setupSfxList';
import {
    ConfigCheckResult,
    checkSoundUsage,
    formatCheckResults,
} from '../../lib/soundConfigChecker';
import {
    formatGenerateConfigHtml,
    generateSoundConfigContent,
    getSoundListKeysFromNode,
    writeSoundConfigFile,
} from '../../lib/soundConfigGenerator';

function getInputValue(el: HTMLElement | null): string {
    return ((el as HTMLInputElement | null)?.value ?? '').trim();
}

function getCheckboxValue(el: HTMLElement | null): boolean {
    return (el as HTMLElement & { value?: boolean } | null)?.value !== false;
}

function setInputValue(el: HTMLElement | null, value: string): void {
    if (!el) {
        return;
    }
    (el as HTMLInputElement).value = value;
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatCheckResultsHtml(results: ConfigCheckResult[]): string {
    const parts: string[] = ['<div class="section-title">=== Sound usage (from sound node) ===</div>'];
    for (const { objectName, used, unusedNotInScene, unusedOnScene } of results) {
        parts.push(`<div class="section-title">--- ${objectName} ---</div>`);
        for (const key of used) {
            parts.push(`<div class="ok">✅ ${escapeHtml(key)}</div>`);
        }
        for (const { key, paths } of unusedOnScene) {
            parts.push(
                `<div class="unused-scene">⚠️ ${escapeHtml(key)} — appear on scene (not in code)</div>`,
            );
            for (const p of paths) {
                parts.push(`<div class="unused-scene-path">${escapeHtml(p)}</div>`);
            }
        }
        for (const key of unusedNotInScene) {
            parts.push(`<div class="unused">❌ ${escapeHtml(key)}</div>`);
        }
        const unusedTotal = unusedNotInScene.length + unusedOnScene.length;
        parts.push(
            `<div class="info">${used.length} used in code · ${unusedTotal} unused in code (${unusedOnScene.length} on scene, ${unusedNotInScene.length} not on scene)</div>`,
        );
    }
    return parts.join('');
}

function logCheckResultsToConsole(results: ConfigCheckResult[]): void {
    console.log('[sound-setup] Check usage\n', formatCheckResults(results));
    const yellowKey = 'color:#fbbf24;font-weight:600';
    const yellowPath = 'color:#fcd34d';
    const dim = 'color:#9ca3af';
    for (const r of results) {
        for (const { key, paths } of r.unusedOnScene) {
            console.log(`%c⚠ ${key}%c — appear on scene (not in code)`, yellowKey, dim);
            for (const p of paths) {
                console.log(`%c  ${p}`, yellowPath);
            }
        }
    }
}

module.exports = Editor.Panel.define({
    listeners: {
        show() {
            void (this as any).syncFromOpenScene();
        },
        hide() {},
    },
    template: readFileSync(join(__dirname, '../../../static/template/default/index.html'), 'utf-8'),
    style: readFileSync(join(__dirname, '../../../static/style/default/index.css'), 'utf-8'),
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
        getSoundNodeUuid(this: any): string | undefined {
            return (this.$.soundNode as HTMLElement & { value?: string })?.value || undefined;
        },
        async syncFromOpenScene(this: any): Promise<void> {
            await this.applyOpenSceneContext();
            await this.autoPickSoundNode({ force: false });
        },

        async applyOpenSceneContext(this: any): Promise<boolean> {
            const hint = this.$.sceneDetectHint as HTMLElement | null;
            try {
                const ctx = await detectGameContextFromOpenScene();
                if (!ctx) {
                    if (hint) {
                        hint.textContent = 'No open scene detected (open a .scene under assets/).';
                    }
                    return false;
                }

                setInputValue(this.$.gameID, ctx.gameId);
                setInputValue(this.$.folder, ctx.projectPath);
                if (hint) {
                    hint.textContent = formatSceneContextHint(ctx);
                }
                console.log('[sound-setup] Detected from open scene', ctx);
                return true;
            } catch (err) {
                if (hint) {
                    hint.textContent = '';
                }
                console.warn('[sound-setup] scene context detection failed', err);
                return false;
            }
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

        /** Resolve Sound node from the active scene (SoundPlayerModuleImpl / SlotSoundPlayerModule*). */
        async autoPickSoundNode(this: any, opts?: { force?: boolean }): Promise<boolean> {
            const force = opts?.force ?? false;
            if (!force && this.getSoundNodeUuid()) {
                return false;
            }
            try {
                const found = await findSoundPlayerNodeInOpenScene();
                if (!found) {
                    if (force) {
                        this.logError('No SoundPlayer node found in the open scene.');
                    }
                    return false;
                }
                const el = this.$.soundNode as HTMLElement & { value?: string };
                if (el) {
                    el.value = found.uuid;
                }
                await this.refreshSoundNodeHint();
                const extra =
                    found.candidateCount > 1
                        ? ` (${found.candidateCount} candidates; picked best match by node name)`
                        : '';
                console.log(`[sound-setup] Auto Sound node: ${found.name} (${found.uuid})${extra}`);
                return true;
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.warn('[sound-setup] auto pick Sound node failed', err);
                if (force) {
                    this.logError(`Auto Sound node failed: ${message}`);
                }
                return false;
            }
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
                const lists = await getSoundListKeysFromNode(nodeUuid);

                if (!lists.sfxSoundIds.length) {
                    this.logError('sfxList is empty on the sound node. Run Setup SFX list first.');
                    return;
                }

                const configFsPath = getConfigFsPath(projectPath, gameId);
                const existingContent = (await fs.pathExists(configFsPath))
                    ? await fs.readFile(configFsPath, 'utf-8')
                    : undefined;

                const generated = generateSoundConfigContent({
                    sfxSoundIds: lists.sfxSoundIds,
                    musicSoundIds: lists.musicSoundIds,
                    preserveBgm,
                    existingContent,
                });

                await writeSoundConfigFile(configFsPath, generated.content);

                const dbUrl = getConfigDbUrl(projectPath, gameId);
                await Editor.Message.request('asset-db', 'refresh-asset', dbUrl);

                this.$.results.innerHTML = formatGenerateConfigHtml(
                    configFsPath,
                    lists,
                    preserveBgm,
                    generated,
                );
                console.log('[sound-setup] Generated SoundConfig from sfxList', lists);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                this.logError(`Generate failed: ${message}`);
                console.error('[sound-setup] generate failed', err);
            }
        },
        async checkUsage(this: any) {
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

            const scriptsDir = getScriptsFsDir(projectPath);
            const configFsPath = getConfigFsPath(projectPath, gameId);
            const configExists = await fs.pathExists(configFsPath);

            try {
                const lists = await getSoundListKeysFromNode(nodeUuid);
                if (!lists.sfxSoundIds.length && !lists.musicSoundIds.length) {
                    this.logError('sfxList and musicList are empty on the sound node.');
                    return;
                }

                const results = await checkSoundUsage({
                    scriptsDir,
                    sfxSoundIds: lists.sfxSoundIds,
                    musicSoundIds: lists.musicSoundIds,
                    configFsPath: configExists ? configFsPath : undefined,
                });
                this.$.results.innerHTML = formatCheckResultsHtml(results);
                logCheckResultsToConsole(results);
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
        const panel = this as any;
        const onSceneReady = () => {
            void panel.syncFromOpenScene();
        };
        panel._onSceneReady = onSceneReady;

        $.btnSetupSfx?.addEventListener('confirm', () => this.setupSfxList());
        $.btnGenerate?.addEventListener('confirm', () => this.generateConfig());
        $.btnCheck?.addEventListener('confirm', () => this.checkUsage());
        $.btnClear?.addEventListener('confirm', () => this.clearResults());
        $.btnPickNode?.addEventListener('confirm', () => this.pickSoundNodeFromSelection());
        $.btnAutoSoundNode?.addEventListener('confirm', () => this.autoPickSoundNode({ force: true }));
        $.btnSyncScene?.addEventListener('confirm', () => this.syncFromOpenScene());
        $.soundNode?.addEventListener('change', () => this.refreshSoundNodeHint());
        $.soundNode?.addEventListener('confirm', () => this.refreshSoundNodeHint());
        if ($.results) {
            $.results.innerHTML = '<span class="info">Open a game scene to auto-fill Game ID and Project path.</span>';
        }

        Editor.Message.addBroadcastListener('scene:ready', onSceneReady);

        void panel.syncFromOpenScene();
    },
    beforeClose() {
        const panel = this as any;
        if (panel._onSceneReady) {
            Editor.Message.removeBroadcastListener('scene:ready', panel._onSceneReady);
            panel._onSceneReady = null;
        }
    },
    close() {},
});
