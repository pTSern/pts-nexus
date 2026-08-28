/**
 * Scene Script for Cocos Creator Runtime Engine Reflection
 */
export const methods = {
    /**
     * Inspect class attributes directly via Cocos Creator runtime CCClass.Attr
     */
    queryClassAttributes(className: string) {
        try {
            const ccAny = (globalThis as any).cc;
            if (!ccAny || !ccAny.js) return null;
            const cls = ccAny.js.getClassByName(className);
            if (!cls) return null;
            
            const attrs = ccAny.Class.Attr.getClassAttrs(cls);
            return {
                className,
                attributes: attrs
            };
        } catch (err: any) {
            return { error: err.message };
        }
    }
};
