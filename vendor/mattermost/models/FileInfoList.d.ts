import type { FileInfo } from './FileInfo.js';
export interface FileInfoList {
    order: Array<string>;
    fileInfos: {
        [key: string]: FileInfo;
    };
    nextFileInfoId: string;
    prevFileInfoId: string;
    firstInaccessibleFileTime: number;
}
export declare function instanceOfFileInfoList(value: object): value is FileInfoList;
export declare function FileInfoListFromJSON(json: any): FileInfoList;
export declare function FileInfoListFromJSONTyped(json: any, ignoreDiscriminator: boolean): FileInfoList;
export declare function FileInfoListToJSON(json: any): FileInfoList;
export declare function FileInfoListToJSONTyped(value?: FileInfoList | null, ignoreDiscriminator?: boolean): any;
