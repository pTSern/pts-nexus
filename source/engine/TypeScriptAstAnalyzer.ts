export interface TsClassMetadata {
    filePath: string;
    className: string;
    ccclass?: string;
    methods: Record<string, string>;
    eventAdds: Array<{ property: string; callback: string }>;
    eventInvokes: Array<{ property: string; argsPassed: string }>;
    eventEmits: Array<{ bounceKey: string; argsPassed: string }>;
    jsonProps: string[];
}

export class TypeScriptAstAnalyzer {
    public static analyzeSource(content: string, filePath: string): TsClassMetadata | null {
        const ccclassMatch = content.match(/@ccclass\s*\(\s*['\"]([^'\"]+)['\"]\s*\)/);
        const classMatch = content.match(/export\s+class\s+([A-Za-z0-9_]+)/);
        if (!classMatch && !ccclassMatch) return null;

        const className = classMatch ? classMatch[1] : (ccclassMatch ? ccclassMatch[1] : 'Unknown');
        const methods: Record<string, string> = {};

        const methodRegex = /(?:public|protected|private|async|\s)+\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/g;
        let match: RegExpExecArray | null;
        while ((match = methodRegex.exec(content)) !== null) {
            const name = match[1];
            if (!['if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(name)) {
                methods[name] = match[2].trim();
            }
        }

        const eventAdds: Array<{ property: string; callback: string }> = [];
        const addRegex = /pEngine\.Json\.event\.add\s*\(\s*this\.([A-Za-z0-9_]+)\s*,\s*\{\s*func:\s*this\.([A-Za-z0-9_]+)/g;
        while ((match = addRegex.exec(content)) !== null) {
            eventAdds.push({ property: match[1], callback: match[2] });
        }

        const eventInvokes: Array<{ property: string; argsPassed: string }> = [];
        const invokeRegex = /pEngine\.Json\.event\.invoke\s*\(\s*this\.([A-Za-z0-9_]+)(?:,\s*([^)]+))?\)/g;
        while ((match = invokeRegex.exec(content)) !== null) {
            eventInvokes.push({ property: match[1], argsPassed: match[2] ? match[2].trim() : '' });
        }

        const eventEmits: Array<{ bounceKey: string; argsPassed: string }> = [];
        const emitRegex = /this\.emit\s*\(\s*['\"]([^'\"]+)['\"](?:,\s*([^)]+))?\)/g;
        while ((match = emitRegex.exec(content)) !== null) {
            eventEmits.push({ bounceKey: match[1], argsPassed: match[2] ? match[2].trim() : '' });
        }

        const jsonProps: string[] = [];
        const propRegex = /@property\s*\([^)]*JsonAsset[^)]*\)\s*(?:get\s+)?([A-Za-z0-9_]+)/g;
        while ((match = propRegex.exec(content)) !== null) {
            jsonProps.push(match[1]);
        }

        return {
            filePath,
            className,
            ccclass: ccclassMatch ? ccclassMatch[1] : undefined,
            methods,
            eventAdds,
            eventInvokes,
            eventEmits,
            jsonProps
        };
    }
}
