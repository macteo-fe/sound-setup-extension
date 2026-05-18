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

export function formatNodeHint(info: SceneNodeInfo | null): string {
    if (!info) {
        return '';
    }
    return `${info.path || info.name} (${info.uuid})`;
}
