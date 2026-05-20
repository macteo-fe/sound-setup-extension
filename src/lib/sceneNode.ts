export interface SceneNodeInfo {
    uuid: string;
    name: string;
    path: string;
}

export async function querySceneNode(nodeUuid: string): Promise<SceneNodeInfo | null> {
    const data = await Editor.Message.request('scene', 'query-node', nodeUuid);
    if (!data) {
        return null;
    }
    const name = (data as { name?: string }).name ?? nodeUuid;
    const path = (data as { path?: string }).path ?? name;
    return { uuid: nodeUuid, name, path };
}

export function getSelectedNodeUuid(): string | null {
    const selected = Editor.Selection.getSelected('node');
    if (selected?.length) {
        return selected[selected.length - 1];
    }
    return Editor.Selection.getLastSelected('node') || null;
}

export interface FoundSoundPlayerNode {
    uuid: string;
    name: string;
    candidateCount: number;
}

export async function findSoundPlayerNodeInOpenScene(): Promise<FoundSoundPlayerNode | null> {
    const raw = (await Editor.Message.request('scene', 'execute-scene-script', {
        name: 'sound-setup',
        method: 'findSoundPlayerNodeUuid',
        args: [],
    })) as { uuid?: string; name?: string; candidateCount?: number } | null;

    const uuid = raw?.uuid?.trim();
    if (!uuid) {
        return null;
    }
    return {
        uuid,
        name: String(raw?.name ?? ''),
        candidateCount: typeof raw?.candidateCount === 'number' ? raw.candidateCount : 1,
    };
}

export function formatNodeHint(info: SceneNodeInfo | null): string {
    if (!info) {
        return '';
    }
    return `${info.path || info.name} (${info.uuid})`;
}
