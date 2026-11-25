export interface PatchPostRequest {
    isPinned?: boolean;
    message?: string;
    fileIds?: Array<string>;
    hasReactions?: boolean;
    props?: {
        [key: string]: any;
    };
}
export declare function instanceOfPatchPostRequest(value: object): value is PatchPostRequest;
export declare function PatchPostRequestFromJSON(json: any): PatchPostRequest;
export declare function PatchPostRequestFromJSONTyped(json: any, ignoreDiscriminator: boolean): PatchPostRequest;
export declare function PatchPostRequestToJSON(json: any): PatchPostRequest;
export declare function PatchPostRequestToJSONTyped(value?: PatchPostRequest | null, ignoreDiscriminator?: boolean): any;
