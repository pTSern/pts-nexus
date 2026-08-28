export class CocosUuidUtils {
    private static readonly BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    private static readonly BASE64_MAP: Record<string, number> = (() => {
        const map: Record<string, number> = {};
        for (let i = 0; i < CocosUuidUtils.BASE64_CHARS.length; i++) {
            map[CocosUuidUtils.BASE64_CHARS[i]] = i;
        }
        return map;
    })();

    public static decompressUuid(uuid: string): string {
        if (!uuid || typeof uuid !== 'string' || uuid.length !== 23) {
            return uuid;
        }
        const prefix = uuid.slice(0, 5);
        const encoded = uuid.slice(5);
        let hex = prefix;

        for (let i = 0; i < encoded.length; i += 2) {
            const high = CocosUuidUtils.BASE64_MAP[encoded[i]];
            const low = CocosUuidUtils.BASE64_MAP[encoded[i + 1]];
            if (high === undefined || low === undefined) return uuid;
            const val = (high << 6) | low;
            hex += val.toString(16).padStart(3, '0');
        }

        if (hex.length === 32) {
            return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        }
        return uuid;
    }
}
