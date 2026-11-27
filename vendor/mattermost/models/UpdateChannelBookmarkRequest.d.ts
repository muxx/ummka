export interface UpdateChannelBookmarkRequest {
    fileId?: string;
    displayName?: string;
    sortOrder?: number;
    linkUrl?: string;
    imageUrl?: string;
    emoji?: string;
}
export declare function instanceOfUpdateChannelBookmarkRequest(value: object): value is UpdateChannelBookmarkRequest;
export declare function UpdateChannelBookmarkRequestFromJSON(json: any): UpdateChannelBookmarkRequest;
export declare function UpdateChannelBookmarkRequestFromJSONTyped(json: any, ignoreDiscriminator: boolean): UpdateChannelBookmarkRequest;
export declare function UpdateChannelBookmarkRequestToJSON(json: any): UpdateChannelBookmarkRequest;
export declare function UpdateChannelBookmarkRequestToJSONTyped(value?: UpdateChannelBookmarkRequest | null, ignoreDiscriminator?: boolean): any;
