import pkg from '../package.json';
import * as path from 'path';
import * as fs from 'fs';
import { NexusGraphBuilder } from './engine/NexusGraphBuilder';
import { generateVisualizerHtml } from './template/visualizer.html';

export const template = `
<div class="nexus-panel-container">
    <div class="nexus-toolbar">
        <div class="toolbar-title">
            <span class="logo">⚡</span>
            <span>pTS Event Nexus Visualizer</span>
        </div>
        <div class="toolbar-actions">
            <ui-button class="refresh-btn" type="primary">Refresh Network</ui-button>
            <ui-button class="export-btn" type="success">Export HTML</ui-button>
        </div>
    </div>
    <div class="nexus-webview-container">
        <iframe class="nexus-frame" frameborder="0" src="about:blank"></iframe>
    </div>
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
}

.nexus-toolbar {
    height: 42px;
    background: #111827;
    border-bottom: 1px solid #1f2937;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    box-sizing: border-box;
}

.toolbar-title {
    font-size: 13px;
    font-weight: bold;
    color: #38bdf8;
    display: flex;
    align-items: center;
    gap: 6px;
}

.toolbar-actions {
    display: flex;
    gap: 8px;
}

.nexus-webview-container {
    flex: 1;
    width: 100%;
    height: calc(100% - 42px);
    position: relative;
}

.nexus-frame {
    width: 100%;
    height: 100%;
    border: none;
}
`;

export const $ = {
    refreshBtn: '.refresh-btn',
    exportBtn: '.export-btn',
    frame: '.nexus-frame'
};

export async function focusTargetInEditor(target: { uuid?: string; path?: string; file?: string; node?: string }) {
    try {
        let uuid = target.uuid;
        const filePath = target.file || target.path || '';

        // If no direct UUID or targeting a specific asset file
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

            // 1. Highlight in Assets panel
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

            // 2. If it is a prefab or scene, open it in Editor
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

async function reloadGraph(thisAny: any) {
    try {
        const projectPath = Editor.Project.path;
        const graph = await NexusGraphBuilder.build(projectPath);
        const html = generateVisualizerHtml(graph);
        
        if (thisAny.$.frame) {
            const blob = new Blob([html], { type: 'text/html' });
            const blobUrl = URL.createObjectURL(blob);
            thisAny.$.frame.src = blobUrl;
        }
    } catch (e) {
        console.error(`[${pkg.name}] Error loading graph:`, e);
    }
}

const onPanelMessage = async (event: MessageEvent) => {
    if (event.data && event.data.type === 'PTS_NEXUS_FOCUS_TARGET') {
        await focusTargetInEditor(event.data.data);
    }
};

export const ready = async function(this: any) {
    window.addEventListener('message', onPanelMessage);
    await reloadGraph(this);

    this.$.refreshBtn?.addEventListener('click', async () => {
        await reloadGraph(this);
    });

    this.$.exportBtn?.addEventListener('click', async () => {
        await Editor.Message.request(pkg.name, 'generate-html');
    });
};

export const close = function(this: any) {
    window.removeEventListener('message', onPanelMessage);
};
