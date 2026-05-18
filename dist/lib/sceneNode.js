"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatNodeHint = exports.getSelectedNodeUuid = exports.querySceneNode = void 0;
async function querySceneNode(nodeUuid) {
    var _a, _b;
    const data = await Editor.Message.request('scene', 'query-node', nodeUuid);
    if (!data) {
        return null;
    }
    const name = (_a = data.name) !== null && _a !== void 0 ? _a : nodeUuid;
    const path = (_b = data.path) !== null && _b !== void 0 ? _b : name;
    return { uuid: nodeUuid, name, path };
}
exports.querySceneNode = querySceneNode;
function getSelectedNodeUuid() {
    const selected = Editor.Selection.getSelected('node');
    if (selected === null || selected === void 0 ? void 0 : selected.length) {
        return selected[selected.length - 1];
    }
    return Editor.Selection.getLastSelected('node') || null;
}
exports.getSelectedNodeUuid = getSelectedNodeUuid;
function formatNodeHint(info) {
    if (!info) {
        return '';
    }
    return `${info.path || info.name} (${info.uuid})`;
}
exports.formatNodeHint = formatNodeHint;
