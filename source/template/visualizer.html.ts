import * as fs from 'fs';
import * as path from 'path';

export function generateVisualizerHtml(networkData: any): string {
    const projectRoot = typeof Editor !== 'undefined' && Editor && Editor.Project && Editor.Project.path ? Editor.Project.path : process.cwd();
    const possiblePaths = [
        path.join(__dirname, '../../static/template/visualizer.html'),
        path.join(__dirname, '../static/template/visualizer.html'),
        path.join(projectRoot, 'extensions/pts-nexus/static/template/visualizer.html')
    ];

    let template = '';
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            template = fs.readFileSync(p, 'utf8');
            break;
        }
    }

    if (!template) {
        throw new Error('[pts-nexus] Could not find visualizer.html template');
    }

    // Unwrap catalog if wrapped in { catalog: ... }
    const rawCatalog = (networkData && networkData.catalog) ? networkData.catalog : (networkData || {});
    const dataJson = JSON.stringify(rawCatalog);
    return template.replace('__NETWORK_DATA_PLACEHOLDER__', dataJson);
}
