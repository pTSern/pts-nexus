import pkg from '../package.json';
import * as path from 'path';
import * as fs from 'fs';
import { NexusGraphBuilder } from './engine/NexusGraphBuilder';
import { TypeRegistry } from './engine/TypeRegistry';
import { generateVisualizerHtml } from './template/visualizer.html';
import { focusTargetInEditor } from './panel';
import { NexusConfigManager } from './config';

export const methods: { [key: string]: (...args: any[]) => any } = {
    openPanel() {
        Editor.Panel.open(pkg.name);
    },
    async focusItem(target: any) {
        await focusTargetInEditor(target);
        return { success: true };
    },
    async scanNetwork() {
        const projectPath = Editor.Project.path;
        console.log(`[${pkg.name}] Scanning project event network in: ${projectPath}`);
        const graph = await NexusGraphBuilder.build(projectPath);
        return graph;
    },
    async 'scan-network'() {
        const projectPath = Editor.Project.path;
        const graph = await NexusGraphBuilder.build(projectPath);
        return graph;
    },
    async generateHtml(customOutputPath?: string) {
        const projectPath = Editor.Project.path;
        const graph = await NexusGraphBuilder.build(projectPath);
        const html = generateVisualizerHtml(graph);
        const outPath = customOutputPath || path.join(projectPath, 'json_event_network.html');
        await fs.promises.writeFile(outPath, html, 'utf8');
        console.log(`[${pkg.name}] Successfully generated HTML visualizer at: ${outPath}`);
        return { success: true, path: outPath };
    },
    async 'generate-html'(customOutputPath?: string) {
        const projectPath = Editor.Project.path;
        const graph = await NexusGraphBuilder.build(projectPath);
        const html = generateVisualizerHtml(graph);
        const outPath = customOutputPath || path.join(projectPath, 'json_event_network.html');
        await fs.promises.writeFile(outPath, html, 'utf8');
        console.log(`[${pkg.name}] Successfully generated HTML visualizer at: ${outPath}`);
        return { success: true, path: outPath };
    },
    getConfig() {
        return NexusConfigManager.readConfig();
    },
    saveConfig(cfg: any) {
        NexusConfigManager.saveConfig(cfg);
        return { success: true };
    }
};

export async function load() {
    console.log(`[${pkg.name}] Extension loaded successfully.`);
    const config = NexusConfigManager.readConfig();
    if (config.isQueryOnLoad) {
        try {
            const projectPath = typeof Editor !== 'undefined' && Editor?.Project?.path ? Editor.Project.path : process.cwd();
            console.log(`[${pkg.name}] 🚀 isQueryOnLoad=true: Warming up TypeRegistry & codebase indexing...`);
            TypeRegistry.build(projectPath).catch(err => {
                console.error(`[${pkg.name}] Error during load-time TypeRegistry query:`, err);
            });
        } catch (e) {
            console.error(`[${pkg.name}] Failed to run load-time query:`, e);
        }
    }
}

export function unload() {
    console.log(`[${pkg.name}] Extension unloaded.`);
}
