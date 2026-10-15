import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

export interface FunctionCallSite {
    callerClass: string;
    callerMethod: string;
    calleeName: string;
    kind: 'method_call' | 'json_invoke' | 'json_add' | 'pts_emit' | 'pts_mutate' | 'event_emit';
    targetAsset?: string;
    args?: string;
    line?: number;
}

export interface MethodWorkflowMeta {
    className: string;
    methodName: string;
    signature: string;
    isAsync: boolean;
    visibility: 'public' | 'protected' | 'private';
    isEntryPoint: boolean;
    entryPointType?: 'lifecycle' | 'ui_trigger' | 'event_handler';
    calls: FunctionCallSite[];
}

export interface WorkflowPipelineStep {
    id: string;
    stepIndex: number;
    type: 'entry' | 'method' | 'event' | 'pts_asset' | 'handler';
    title: string;
    subtitle: string;
    file?: string;
    detail?: string;
    nextStepIds: string[];
}

export interface WorkflowPipeline {
    id: string;
    title: string;
    domain: string;
    domainIcon: string;
    entryPoint: string;
    summary: string;
    steps: WorkflowPipelineStep[];
}

export class FunctionWorkflowAnalyzer {
    private static methodsMap = new Map<string, MethodWorkflowMeta>(); // "ClassName.methodName" -> meta

    public static getMethod(className: string, methodName: string): MethodWorkflowMeta | undefined {
        return this.methodsMap.get(`${className}.${methodName}`);
    }

    public static analyzeSource(content: string, filePath: string): MethodWorkflowMeta[] {
        const sourceFile = ts.createSourceFile(
            filePath,
            content,
            ts.ScriptTarget.Latest,
            true
        );

        const results: MethodWorkflowMeta[] = [];

        const visitNode = (node: ts.Node, currentClass?: string) => {
            if (ts.isClassDeclaration(node) && node.name) {
                const className = node.name.text;
                ts.forEachChild(node, member => visitNode(member, className));
                return;
            }

            if (currentClass && (ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node))) {
                const methodName = ts.isConstructorDeclaration(node) ? 'constructor' : (node.name && ts.isIdentifier(node.name) ? node.name.text : 'anonymous');
                const isAsync = !!(node.modifiers && node.modifiers.some(m => m.kind === ts.SyntaxKind.AsyncKeyword));
                
                let visibility: 'public' | 'protected' | 'private' = 'public';
                if (node.modifiers) {
                    if (node.modifiers.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)) visibility = 'private';
                    else if (node.modifiers.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword)) visibility = 'protected';
                }

                // Check Entry Point characteristics
                const isLifecycle = ['onLoad', 'start', 'update', 'lateUpdate', 'onEnable', 'onDisable', 'onDestroy'].includes(methodName);
                const isUiTrigger = methodName.startsWith('on') && (methodName.includes('Click') || methodName.includes('Touch') || methodName.includes('Btn') || methodName.includes('Button') || methodName.includes('Press'));
                const isEventHandler = methodName.startsWith('on') || methodName.startsWith('handle') || methodName.startsWith('act') || methodName.startsWith('evt');

                const isEntryPoint = isLifecycle || isUiTrigger;
                const entryPointType = isLifecycle ? 'lifecycle' : (isUiTrigger ? 'ui_trigger' : (isEventHandler ? 'event_handler' : undefined));

                const params = node.parameters.map(p => {
                    const pName = p.name.getText(sourceFile);
                    const pType = p.type ? p.type.getText(sourceFile) : 'any';
                    return `${pName}: ${pType}`;
                }).join(', ');

                const retType = node.type ? node.type.getText(sourceFile) : (isAsync ? 'Promise<void>' : 'void');
                const signature = `${methodName}(${params}): ${retType}`;

                const calls: FunctionCallSite[] = [];

                // Traverse method body for call expressions
                if (node.body) {
                    const findCalls = (bodyNode: ts.Node) => {
                        if (ts.isCallExpression(bodyNode)) {
                            const exprText = bodyNode.expression.getText(sourceFile);

                            // 1. pEngine.Json.event.invoke(this.someJson, ...)
                            if (exprText.includes('pEngine.Json.event.invoke')) {
                                const targetArg = bodyNode.arguments[0] ? bodyNode.arguments[0].getText(sourceFile).replace(/^this\./, '') : '';
                                const args = bodyNode.arguments.slice(1).map(a => a.getText(sourceFile)).join(', ');
                                calls.push({
                                    callerClass: currentClass,
                                    callerMethod: methodName,
                                    calleeName: 'pEngine.Json.event.invoke',
                                    kind: 'json_invoke',
                                    targetAsset: targetArg,
                                    args
                                });
                            }
                            // 2. pEngine.Json.event.add(this.someJson, { func: this.func })
                            else if (exprText.includes('pEngine.Json.event.add')) {
                                const targetArg = bodyNode.arguments[0] ? bodyNode.arguments[0].getText(sourceFile).replace(/^this\./, '') : '';
                                calls.push({
                                    callerClass: currentClass,
                                    callerMethod: methodName,
                                    calleeName: 'pEngine.Json.event.add',
                                    kind: 'json_add',
                                    targetAsset: targetArg
                                });
                            }
                            // 3. pTSAsset emit: this.asset.emit(...) or pTSAsset.add(...)
                            else if (exprText.endsWith('.emit') || exprText === 'this.emit') {
                                const args = bodyNode.arguments.map(a => a.getText(sourceFile)).join(', ');
                                calls.push({
                                    callerClass: currentClass,
                                    callerMethod: methodName,
                                    calleeName: exprText,
                                    kind: exprText === 'this.emit' ? 'event_emit' : 'pts_emit',
                                    args
                                });
                            }
                            // 4. pTSAsset / Data mutation: .set(...) or .get(...)
                            else if (exprText.endsWith('.set') || exprText.endsWith('.setData')) {
                                const args = bodyNode.arguments.map(a => a.getText(sourceFile)).join(', ');
                                calls.push({
                                    callerClass: currentClass,
                                    callerMethod: methodName,
                                    calleeName: exprText,
                                    kind: 'pts_mutate',
                                    args
                                });
                            }
                            // 5. Internal method call: this.methodName(...)
                            else if (exprText.startsWith('this.')) {
                                const callee = exprText.substring(5).split('(')[0];
                                if (!callee.includes('.')) {
                                    const args = bodyNode.arguments.map(a => a.getText(sourceFile)).join(', ');
                                    calls.push({
                                        callerClass: currentClass,
                                        callerMethod: methodName,
                                        calleeName: `${currentClass}.${callee}`,
                                        kind: 'method_call',
                                        args
                                    });
                                }
                            }
                            // 6. Controller / Manager calls: this.controller.method(...)
                            else if (exprText.includes('.')) {
                                const parts = exprText.split('.');
                                const callee = parts[parts.length - 1];
                                const args = bodyNode.arguments.map(a => a.getText(sourceFile)).join(', ');
                                calls.push({
                                    callerClass: currentClass,
                                    callerMethod: methodName,
                                    calleeName: `${parts.slice(-2).join('.')}`,
                                    kind: 'method_call',
                                    args
                                });
                            }
                        }
                        ts.forEachChild(bodyNode, findCalls);
                    };
                    findCalls(node.body);
                }

                const meta: MethodWorkflowMeta = {
                    className: currentClass,
                    methodName,
                    signature,
                    isAsync,
                    visibility,
                    isEntryPoint,
                    entryPointType,
                    calls
                };

                this.methodsMap.set(`${currentClass}.${methodName}`, meta);
                results.push(meta);
                return;
            }

            ts.forEachChild(node, child => visitNode(child, currentClass));
        };

        ts.forEachChild(sourceFile, node => visitNode(node));
        return results;
    }

    /**
     * Builds execution flow pipelines starting from major Entry Points (UI Clicks, Lifecycle, Event Handlers)
     */
    public static buildPipelines(catalog: Record<string, any>): WorkflowPipeline[] {
        const pipelines: WorkflowPipeline[] = [];
        let pipelineIdx = 1;

        // Group entry points by significance
        for (const [key, method] of this.methodsMap.entries()) {
            // Focus on UI buttons, controllers, and prominent entry points that execute actions
            if (!method.isEntryPoint || method.calls.length === 0) continue;

            const domain = this.inferDomain(method.className);
            const domainIcon = this.inferDomainIcon(domain);
            const steps: WorkflowPipelineStep[] = [];
            const visited = new Set<string>();

            const entryStepId = `step_${method.className}_${method.methodName}_0`;
            steps.push({
                id: entryStepId,
                stepIndex: 1,
                type: 'entry',
                title: `${method.className} · ${method.methodName}()`,
                subtitle: method.entryPointType === 'ui_trigger' ? '🖱️ UI User Action' : '🔄 Lifecycle Hook',
                detail: method.signature,
                nextStepIds: []
            });

            visited.add(key);

            let currentStepIdx = 2;
            let prevStepId = entryStepId;

            // Follow first 2-3 levels of execution
            for (const call of method.calls) {
                if (call.kind === 'json_invoke') {
                    const stepId = `step_json_${call.targetAsset || 'event'}_${currentStepIdx}`;
                    steps.push({
                        id: stepId,
                        stepIndex: currentStepIdx++,
                        type: 'event',
                        title: `⚡ Invoke Event: ${call.targetAsset || 'Event'}`,
                        subtitle: 'pEngine.Json Event Broadcast',
                        detail: call.args ? `Payload: (${call.args})` : undefined,
                        nextStepIds: []
                    });
                    const prevStep = steps.find(s => s.id === prevStepId);
                    if (prevStep) prevStep.nextStepIds.push(stepId);
                    prevStepId = stepId;
                } else if (call.kind === 'pts_emit' || call.kind === 'pts_mutate') {
                    const stepId = `step_pts_${call.calleeName}_${currentStepIdx}`;
                    steps.push({
                        id: stepId,
                        stepIndex: currentStepIdx++,
                        type: 'pts_asset',
                        title: `💎 Reactive State: ${call.calleeName}()`,
                        subtitle: 'pTSAsset State Mutation',
                        detail: call.args ? `Args: (${call.args})` : undefined,
                        nextStepIds: []
                    });
                    const prevStep = steps.find(s => s.id === prevStepId);
                    if (prevStep) prevStep.nextStepIds.push(stepId);
                    prevStepId = stepId;
                } else if (call.kind === 'method_call') {
                    const stepId = `step_call_${call.calleeName.replace(/\./g, '_')}_${currentStepIdx}`;
                    steps.push({
                        id: stepId,
                        stepIndex: currentStepIdx++,
                        type: 'method',
                        title: `${call.calleeName}()`,
                        subtitle: 'Sub-routine Execution',
                        detail: call.args ? `Args: (${call.args})` : undefined,
                        nextStepIds: []
                    });
                    const prevStep = steps.find(s => s.id === prevStepId);
                    if (prevStep) prevStep.nextStepIds.push(stepId);
                    prevStepId = stepId;
                }
            }

            if (steps.length >= 2) {
                pipelines.push({
                    id: `pipe_${pipelineIdx++}`,
                    title: `${method.className} ➔ ${method.methodName}()`,
                    domain,
                    domainIcon,
                    entryPoint: `${method.className}.${method.methodName}()`,
                    summary: `Traces ${steps.length} sequential execution stages from ${method.methodName}()`,
                    steps
                });
            }

            if (pipelines.length >= 40) break; // Keep curated selection of top 40 workflows
        }

        return pipelines;
    }

    private static inferDomain(className: string): string {
        const lower = className.toLowerCase();
        if (lower.includes('match') || lower.includes('gameplay') || lower.includes('level') || lower.includes('tile')) return 'Gameplay Loop';
        if (lower.includes('ui') || lower.includes('button') || lower.includes('screen') || lower.includes('popup')) return 'UI Flow';
        if (lower.includes('data') || lower.includes('coin') || lower.includes('energy') || lower.includes('star')) return 'Economy & Data';
        if (lower.includes('ad') || lower.includes('reward')) return 'Ads System';
        if (lower.includes('audio') || lower.includes('sound')) return 'Audio';
        return 'Core System';
    }

    private static inferDomainIcon(domain: string): string {
        switch (domain) {
            case 'Gameplay Loop': return '🎮';
            case 'UI Flow': return '🖥️';
            case 'Economy & Data': return '🪙';
            case 'Ads System': return '📺';
            case 'Audio': return '🎵';
            default: return '⚡';
        }
    }
}
