import pkg from '../package.json';
import * as path from 'path';
import * as fs from 'fs';
import { NexusGraphBuilder } from './engine/NexusGraphBuilder';
import { generateVisualizerHtml } from './template/visualizer.html';

export const template = `
<div class="nexus-panel-container">
    <iframe class="nexus-frame" frameborder="0" src="about:blank"></iframe>
</div>
`;

export const style = `
:host {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    overflow: hidden;
    background: #0b0f19;
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

.nexus-panel-container {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    position: relative;
}

.nexus-frame {
    width: 100%;
    height: 100%;
    border: none;
}
`;

export const $ = {
    frame: '.nexus-frame'
};

export async function focusTargetInEditor(target: {
    uuid?: string;
    path?: string;
    file?: string;
    node?: string;
    nodePath?: string;
    nodeUuid?: string;
    nodeName?: string;
    className?: string;
    scriptFile?: string;
    type?: string;
}) {
    try {
        const filePath = target.file || target.path || '';
        const targetType = target.type || (target.node || target.nodePath ? 'node' : 'asset');

        let fileAssetUuid = target.uuid;
        if (!fileAssetUuid && filePath) {
            const dbPath = filePath.startsWith('assets/') || filePath.startsWith('extensions/')
                ? `db://${filePath}`
                : (filePath.startsWith('db://') ? filePath : `db://${filePath}`);
            try {
                fileAssetUuid = await Editor.Message.request('asset-db', 'query-uuid', dbPath);
            } catch {}
        }

        // ========================================================
        // 1. SCENE ASSET FOCUS: Just open / select the scene/prefab
        // ========================================================
        if (targetType === 'scene' || (!target.node && !target.nodePath && !target.nodeUuid)) {
            if (fileAssetUuid) {
                console.log(`[${pkg.name}] 🎯 Opening asset in Cocos Creator: ${fileAssetUuid} (${filePath})`);
                try {
                    if (Editor.Selection && typeof Editor.Selection.select === 'function') {
                        Editor.Selection.select('asset', fileAssetUuid);
                    }
                } catch {}
                try {
                    await Editor.Message.send('assets', 'twinkle', fileAssetUuid);
                } catch {}
                try {
                    await Editor.Message.request('asset-db', 'open-asset', fileAssetUuid);
                } catch {}
            }
            return;
        }

        // ========================================================
        // 2. NODE / COMPONENT / WORKFLOW FOCUS IN SCENE
        // ========================================================
        const targetNodePath = target.nodePath || target.node || '';
        const targetNodeName = target.nodeName || targetNodePath.split('/').pop() || '';
        let resolvedNodeUuid: string | null = target.nodeUuid || null;

        const findNodeInTree = (curr: any, pathSoFar: string): string | null => {
            if (!curr) return null;
            const fullPath = pathSoFar ? `${pathSoFar}/${curr.name}` : curr.name;

            if (target.nodeUuid && curr.uuid === target.nodeUuid) {
                return curr.uuid;
            }
            if (targetNodePath && (fullPath === targetNodePath || fullPath.endsWith('/' + targetNodePath))) {
                return curr.uuid;
            }
            if (targetNodeName && curr.name === targetNodeName) {
                return curr.uuid;
            }

            if (Array.isArray(curr.children)) {
                for (const child of curr.children) {
                    const found = findNodeInTree(child, fullPath);
                    if (found) return found;
                }
            }
            return null;
        };

        // Step A: Check if target node is already in current active scene tree
        let sceneTree: any = null;
        try {
            sceneTree = await Editor.Message.request('scene', 'query-node-tree');
        } catch {}

        let foundUuid = sceneTree ? findNodeInTree(sceneTree, '') : null;

        // Step B: If not found in current scene and target file is specified, open asset in Cocos and re-query
        if (!foundUuid && fileAssetUuid && (filePath.endsWith('.scene') || filePath.endsWith('.prefab'))) {
            try {
                console.log(`[${pkg.name}] Opening asset '${filePath}' in Cocos to focus node...`);
                await Editor.Message.request('asset-db', 'open-asset', fileAssetUuid);
                // Give editor time to switch and initialize scene hierarchy
                await new Promise(r => setTimeout(r, 800));
                sceneTree = await Editor.Message.request('scene', 'query-node-tree');
                if (sceneTree) {
                    foundUuid = findNodeInTree(sceneTree, '');
                }
            } catch (openErr) {
                console.warn(`[${pkg.name}] Failed to open asset for node inspection:`, openErr);
            }
        }

        if (foundUuid) {
            resolvedNodeUuid = foundUuid;
        }

        if (resolvedNodeUuid) {
            console.log(`[${pkg.name}] 🎯 Highlighting & focusing live node in Cocos: ${resolvedNodeUuid} (${targetNodePath || targetNodeName})`);

            // 1. Select node in Editor.Selection (this highlights node in Hierarchy and loads it into Inspector)
            try {
                if (Editor.Selection && typeof Editor.Selection.select === 'function') {
                    Editor.Selection.select('node', resolvedNodeUuid);
                }
            } catch {}

            // 2. Notify scene process of selection change
            try {
                await Editor.Message.send('scene', 'change-node-selection', [resolvedNodeUuid]);
            } catch {}

            // 3. Focus scene viewport camera onto the node
            try {
                await Editor.Message.request('scene', 'focus-camera', [resolvedNodeUuid]);
            } catch {
                try {
                    await Editor.Message.send('scene', 'focus-camera', [resolvedNodeUuid]);
                } catch {}
            }

            // 4. Twinkle / flash in Hierarchy panel
            try {
                await Editor.Message.send('hierarchy', 'twinkle', resolvedNodeUuid);
            } catch {}
        } else {
            console.warn(`[${pkg.name}] Node '${targetNodePath || targetNodeName}' not found in active scene hierarchy.`);
        }
    } catch (e) {
        console.error(`[${pkg.name}] Failed to focus target in Editor:`, e);
    }
}

let panelInstance: any = null;

async function reloadGraph(thisAny: any) {
    try {
        const projectPath = Editor.Project.path;
        console.log(`[${pkg.name}] Reloading and re-scanning event graph...`);
        const graph = await NexusGraphBuilder.build(projectPath);
        const html = generateVisualizerHtml(graph);
        
        if (thisAny && thisAny.$.frame) {
            try {
                thisAny.$.frame.srcdoc = html;
            } catch {
                const blob = new Blob([html], { type: 'text/html' });
                const blobUrl = URL.createObjectURL(blob);
                thisAny.$.frame.src = blobUrl;
            }
        }
    } catch (e) {
        console.error(`[${pkg.name}] Error loading graph:`, e);
    }
}

const onPanelMessage = async (event: MessageEvent) => {
    if (!event.data) return;

    if (event.data.type === 'PTS_NEXUS_FOCUS_TARGET') {
        await focusTargetInEditor(event.data.data);
    } else if (event.data.type === 'PTS_NEXUS_REFRESH_NETWORK') {
        if (panelInstance) {
            await reloadGraph(panelInstance);
        }
    } else if (event.data.type === 'PTS_NEXUS_EXPORT_HTML') {
        try {
            await Editor.Message.request(pkg.name, 'generate-html');
            console.log(`[${pkg.name}] Standalone visualizer exported successfully to project root.`);
        } catch (e) {
            console.error(`[${pkg.name}] Failed to export HTML:`, e);
        }
    }
};

export const ready = async function(this: any) {
    panelInstance = this;
    window.addEventListener('message', onPanelMessage);
    await reloadGraph(this);
};

export const close = function(this: any) {
    panelInstance = null;
    window.removeEventListener('message', onPanelMessage);
};
