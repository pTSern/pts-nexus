import * as path from 'path';
import { NexusGraphBuilder, EventNetworkGraph } from './NexusGraphBuilder';
import { SceneFlowTree, SceneNodeFlow, SceneComponentFlow } from './SceneFlowAnalyzer';
import { WorkflowPipeline } from './FunctionWorkflowAnalyzer';

export interface TreeGraphQueryOptions {
    type?: 'scene_flow' | 'workflow' | 'event_nexus' | 'list_scenes' | 'list_workflows' | 'all';
    target?: string;       // scene name/path (e.g. "fast_test.scene"), workflow ID, or event name/UUID
    nodePath?: string;     // optional filter to a specific node or subtree (e.g. "Canvas" or "Canvas/Camera")
    format?: 'json' | 'ascii' | 'both';
    maxDepth?: number;
}

export interface TreeGraphQueryResult {
    success: boolean;
    type: string;
    target?: string;
    message: string;
    summary?: Record<string, any>;
    data?: any;
    asciiTree?: string;
}

export class TreeGraphQueryEngine {
    private static cachedGraph: EventNetworkGraph | null = null;
    private static lastBuildTime = 0;

    public static async getOrBuildGraph(projectPath: string, force = false): Promise<EventNetworkGraph> {
        const now = Date.now();
        // Cache graph in memory for 30 seconds unless forced
        if (!force && this.cachedGraph && (now - this.lastBuildTime < 30000)) {
            return this.cachedGraph;
        }

        this.cachedGraph = await NexusGraphBuilder.build(projectPath);
        this.lastBuildTime = now;
        return this.cachedGraph;
    }

    public static async query(projectPath: string, options: TreeGraphQueryOptions = {}): Promise<TreeGraphQueryResult> {
        const graph = await this.getOrBuildGraph(projectPath);
        const format = options.format || 'both';
        const type = options.type || this.inferQueryType(options.target);

        switch (type) {
            case 'list_scenes':
                return this.listScenes(graph);
            case 'list_workflows':
                return this.listWorkflows(graph);
            case 'scene_flow':
                return this.querySceneFlow(graph, options, format);
            case 'workflow':
                return this.queryWorkflow(graph, options, format);
            case 'event_nexus':
                return this.queryEventNexus(graph, options, format);
            default:
                return this.querySceneFlow(graph, options, format);
        }
    }

    private static inferQueryType(target?: string): 'scene_flow' | 'workflow' | 'event_nexus' {
        if (!target) return 'scene_flow';
        const lower = target.toLowerCase();
        if (lower.endsWith('.scene') || lower.endsWith('.prefab') || lower.includes('scene') || lower.includes('prefab')) {
            return 'scene_flow';
        }
        if (lower.startsWith('pipe_') || lower.includes('➔') || lower.includes('->') || lower.includes('()')) {
            return 'workflow';
        }
        if (lower.endsWith('.json') || lower.endsWith('.pts') || lower.startsWith('evt_')) {
            return 'event_nexus';
        }
        return 'scene_flow';
    }

    private static listScenes(graph: EventNetworkGraph): TreeGraphQueryResult {
        const scenes = Object.keys(graph.sceneFlows || {}).map(p => {
            const tree = graph.sceneFlows![p];
            return {
                path: p,
                name: tree.sceneName,
                isPrefab: tree.isPrefab,
                summary: tree.summary
            };
        });

        return {
            success: true,
            type: 'list_scenes',
            message: `Found ${scenes.length} scenes & prefabs in project`,
            data: scenes
        };
    }

    private static listWorkflows(graph: EventNetworkGraph): TreeGraphQueryResult {
        const workflows = (graph.workflows || []).map(w => ({
            id: w.id,
            title: w.title,
            domain: w.domain,
            entryPoint: w.entryPoint,
            stepCount: w.steps.length
        }));

        return {
            success: true,
            type: 'list_workflows',
            message: `Found ${workflows.length} execution workflows in project`,
            data: workflows
        };
    }

    private static querySceneFlow(
        graph: EventNetworkGraph,
        options: TreeGraphQueryOptions,
        format: 'json' | 'ascii' | 'both'
    ): TreeGraphQueryResult {
        const flows = graph.sceneFlows || {};
        const target = (options.target || 'fast_test').toLowerCase();

        // 1. Locate matching scene flow
        let foundKey = Object.keys(flows).find(k => k.toLowerCase() === target);
        if (!foundKey) {
            foundKey = Object.keys(flows).find(k => {
                const base = path.basename(k).toLowerCase();
                return base === target || base === `${target}.scene` || base.includes(target) || k.toLowerCase().includes(target);
            });
        }

        if (!foundKey) {
            // Default to fast_test or first scene if available
            foundKey = Object.keys(flows).find(k => k.includes('fast_test')) || Object.keys(flows)[0];
        }

        if (!foundKey || !flows[foundKey]) {
            return {
                success: false,
                type: 'scene_flow',
                target: options.target,
                message: `Scene or prefab '${options.target}' not found in project.`
            };
        }

        const tree = flows[foundKey];

        // 2. Filter by nodePath if specified
        let rootNodeIds = tree.rootNodeIds;
        let filteredNodes = tree.nodes;

        if (options.nodePath) {
            const targetPath = options.nodePath.toLowerCase();
            const matchedNode = Object.values(tree.nodes).find(n => n.name.toLowerCase() === targetPath || n.path.toLowerCase().endsWith(targetPath));

            if (matchedNode) {
                rootNodeIds = [matchedNode.id];
                const collectSubtree = (nId: string, acc: Record<string, SceneNodeFlow>) => {
                    const node = tree.nodes[nId];
                    if (!node) return;
                    acc[nId] = node;
                    node.childrenIds.forEach(cId => collectSubtree(cId, acc));
                };
                filteredNodes = {};
                collectSubtree(matchedNode.id, filteredNodes);
            }
        }

        // 3. Generate ASCII Diagram
        let asciiTree: string | undefined = undefined;
        if (format === 'ascii' || format === 'both') {
            asciiTree = this.buildSceneAsciiTree(tree, rootNodeIds, filteredNodes, options.maxDepth || 8);
        }

        return {
            success: true,
            type: 'scene_flow',
            target: foundKey,
            message: `✅ Scene Flow Tree retrieved: ${tree.sceneName} (${Object.keys(filteredNodes).length} nodes, ${tree.summary.totalComponents} comps)`,
            summary: tree.summary,
            data: format !== 'ascii' ? {
                scenePath: tree.scenePath,
                sceneName: tree.sceneName,
                isPrefab: tree.isPrefab,
                rootNodeIds,
                nodes: filteredNodes
            } : undefined,
            asciiTree
        };
    }

    private static buildSceneAsciiTree(
        tree: SceneFlowTree,
        rootNodeIds: string[],
        nodes: Record<string, SceneNodeFlow>,
        maxDepth: number
    ): string {
        const lines: string[] = [];
        lines.push(`🎬 ${tree.sceneName}`);

        const printNode = (nodeId: string, indent: string, depth: number) => {
            if (depth > maxDepth) return;
            const node = nodes[nodeId];
            if (!node) return;

            const icon = node.name === 'Canvas' ? '🖼️' : (node.name === 'Camera' ? '📷' : (node.name === 'Config' ? '⚙️' : '📦'));
            lines.push(`${indent}|`);
            lines.push(`${indent}+-- ${icon} ${node.name} (Path: ${node.path}, Active: ${node.active})`);

            const compIndent = `${indent}|     `;

            // Print components
            node.components.forEach(comp => {
                const scriptTag = comp.isCustomScript ? ` [${comp.scriptFile ? path.basename(comp.scriptFile) : 'Script'}]` : '';
                lines.push(`${compIndent}|-- ${comp.className}${scriptTag}`);

                // Print attached workflows
                comp.workflows.forEach(wf => {
                    const cleanTitle = (wf.title || 'Workflow').replace(/^\(\s*/, '').replace(/\s*\)$/, '');
                    lines.push(`${compIndent}|     |-- Workflow: ${cleanTitle}`);
                });
            });

            // Print child nodes
            node.childrenIds.forEach(childId => {
                if (nodes[childId]) {
                    lines.push(`${compIndent}|-- Children:`);
                    printNode(childId, `${compIndent}    `, depth + 1);
                }
            });
        };

        rootNodeIds.forEach(rId => printNode(rId, '  ', 1));
        return lines.join('\n');
    }

    private static queryWorkflow(
        graph: EventNetworkGraph,
        options: TreeGraphQueryOptions,
        format: 'json' | 'ascii' | 'both'
    ): TreeGraphQueryResult {
        const workflows = graph.workflows || [];
        const target = (options.target || '').toLowerCase();

        let found = workflows.find(w => w.id.toLowerCase() === target || w.entryPoint.toLowerCase().includes(target) || w.title.toLowerCase().includes(target));
        if (!found && workflows.length > 0) {
            found = workflows[0];
        }

        if (!found) {
            return {
                success: false,
                type: 'workflow',
                target: options.target,
                message: `Workflow '${options.target}' not found.`
            };
        }

        let asciiTree: string | undefined = undefined;
        if (format === 'ascii' || format === 'both') {
            const lines: string[] = [];
            lines.push(`Workflow Pipeline: ${found.title} (Domain: ${found.domain} ${found.domainIcon})`);
            lines.push(`Entry Point: ${found.entryPoint}`);
            lines.push(`Stages (${found.steps.length}):`);

            found.steps.forEach(s => {
                const prefix = '  '.repeat(s.stepIndex);
                lines.push(`${prefix}[Step ${s.stepIndex}: ${s.subtitle}] ${s.title}`);
                if (s.detail) lines.push(`${prefix}  └─ ${s.detail}`);
            });
            asciiTree = lines.join('\n');
        }

        return {
            success: true,
            type: 'workflow',
            target: found.id,
            message: `✅ Workflow Pipeline retrieved: ${found.title}`,
            data: format !== 'ascii' ? found : undefined,
            asciiTree
        };
    }

    private static queryEventNexus(
        graph: EventNetworkGraph,
        options: TreeGraphQueryOptions,
        format: 'json' | 'ascii' | 'both'
    ): TreeGraphQueryResult {
        const catalog = graph.catalog || {};
        const target = (options.target || '').toLowerCase();

        let foundKey = Object.keys(catalog).find(k => k.toLowerCase() === target);
        if (!foundKey) {
            foundKey = Object.keys(catalog).find(k => {
                const item = catalog[k];
                return item.name.toLowerCase() === target || item.name.toLowerCase().includes(target) || item.path.toLowerCase().includes(target);
            });
        }

        if (!foundKey) {
            return {
                success: false,
                type: 'event_nexus',
                target: options.target,
                message: `Event or pTSAsset '${options.target}' not found in catalog.`
            };
        }

        const item = catalog[foundKey];

        let asciiTree: string | undefined = undefined;
        if (format === 'ascii' || format === 'both') {
            const lines: string[] = [];
            const icon = item.assetType === 'pts' ? '💎' : '⚡';
            lines.push(`${icon} ${item.name} (${item.assetType === 'pts' ? item.ptsType : 'JsonAsset'}, Domain: ${item.domain})`);
            lines.push(`Path: ${item.path}`);
            lines.push(`Emitters (${item.emitters.length}):`);
            item.emitters.forEach((e: any) => lines.push(`  <-- [${e.file}] ${e.node} · ${e.className} (⚡ ${e.trigger || e.functionName})`));
            lines.push(`Listeners (${item.listeners.length}):`);
            item.listeners.forEach((l: any) => lines.push(`  --> [${l.file}] ${l.node} · ${l.className} (🎧 ${l.boundMethod || l.property}())`));
            lines.push(`Params (${item.params.length}):`);
            item.params.forEach((p: any) => lines.push(`  ... [${p.file}] ${p.node} · ${p.className} (📦 ${p.property})`));
            asciiTree = lines.join('\n');
        }

        return {
            success: true,
            type: 'event_nexus',
            target: item.uuid,
            message: `✅ Event Hub retrieved: ${item.name}`,
            data: format !== 'ascii' ? item : undefined,
            asciiTree
        };
    }
}
