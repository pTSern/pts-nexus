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

export async function focusTargetInEditor(target: { uuid?: string; path?: string; file?: string; node?: string }) {
    try {
        let uuid = target.uuid;
        const filePath = target.file || target.path || '';

        if (!uuid && filePath) {
            const dbPath = filePath.startsWith('assets/') || filePath.startsWith('extensions/') ? `db://${filePath}` : (filePath.startsWith('db://') ? filePath : `db://${filePath}`);
            try {
                const queryUuid = await Editor.Message.request('asset-db', 'query-uuid', dbPath);
                if (queryUuid) {
                    uuid = queryUuid;
                }
            } catch {}
        }

        if (uuid) {
            console.log(`[${pkg.name}] 🎯 Focusing asset in Cocos Creator: ${uuid} (${filePath})`);

            try {
                if (Editor.Selection && typeof Editor.Selection.select === 'function') {
                    Editor.Selection.select('asset', uuid);
                }
            } catch {}

            try {
                await Editor.Message.send('assets', 'twinkle', uuid);
            } catch {}

            try {
                await Editor.Message.send('assets', 'select', uuid);
            } catch {}

            if (filePath.endsWith('.prefab') || filePath.endsWith('.scene')) {
                try {
                    await Editor.Message.request('asset-db', 'open-asset', uuid);
                } catch {}
            }
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
            const blob = new Blob([html], { type: 'text/html' });
            const blobUrl = URL.createObjectURL(blob);
            thisAny.$.frame.src = blobUrl;
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
