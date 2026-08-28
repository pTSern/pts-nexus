import pkg from '../package.json';
import * as path from 'path';
import * as fs from 'fs';
import { NexusGraphBuilder } from './engine/NexusGraphBuilder';
import { generateVisualizerHtml } from './template/visualizer.html';
import { focusTargetInEditor } from './panel';

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
    async generateHtml(customOutputPath?: string) {
        const projectPath = Editor.Project.path;
        const graph = await NexusGraphBuilder.build(projectPath);
        const html = generateVisualizerHtml(graph);
        const outPath = customOutputPath || path.join(projectPath, 'json_event_network.html');
        await fs.promises.writeFile(outPath, html, 'utf8');
        console.log(`[${pkg.name}] Successfully generated HTML visualizer at: ${outPath}`);
        return { success: true, path: outPath };
    }
};

export function load() {
    console.log(`[${pkg.name}] Extension loaded successfully.`);
}

export function unload() {
    console.log(`[${pkg.name}] Extension unloaded.`);
}
