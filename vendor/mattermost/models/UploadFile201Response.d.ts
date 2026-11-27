import type { FileInfo } from './FileInfo.js';
export interface UploadFile201Response {
    fileInfos?: Array<FileInfo>;
    clientIds?: Array<string>;
}
export declare function instanceOfUploadFile201Response(value: object): value is UploadFile201Response;
export declare function UploadFile201ResponseFromJSON(json: any): UploadFile201Response;
export declare function UploadFile201ResponseFromJSONTyped(json: any, ignoreDiscriminator: boolean): UploadFile201Response;
export declare function UploadFile201ResponseToJSON(json: any): UploadFile201Response;
export declare function UploadFile201ResponseToJSONTyped(value?: UploadFile201Response | null, ignoreDiscriminator?: boolean): any;
