export interface FileInfo {
    id?: string;
    userId?: string;
    postId?: string;
    createAt?: number;
    updateAt?: number;
    deleteAt?: number;
    name?: string;
    extension?: string;
    size?: number;
    mimeType?: string;
    width?: number;
    height?: number;
    hasPreviewImage?: boolean;
    channelId?: string;
    archived?: boolean;
}
export declare function instanceOfFileInfo(value: object): value is FileInfo;
export declare function FileInfoFromJSON(json: any): FileInfo;
export declare function FileInfoFromJSONTyped(json: any, ignoreDiscriminator: boolean): FileInfo;
export declare function FileInfoToJSON(json: any): FileInfo;
export declare function FileInfoToJSONTyped(value?: FileInfo | null, ignoreDiscriminator?: boolean): any;
