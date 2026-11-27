export interface CreateChannelBookmarkRequest {
    fileId?: string;
    displayName: string;
    linkUrl?: string;
    imageUrl?: string;
    emoji?: string;
    type: CreateChannelBookmarkRequestTypeEnum;
}
export declare const CreateChannelBookmarkRequestTypeEnum: {
    readonly Link: 'link';
    readonly File: 'file';
};
export type CreateChannelBookmarkRequestTypeEnum = typeof CreateChannelBookmarkRequestTypeEnum[keyof typeof CreateChannelBookmarkRequestTypeEnum];
export declare function instanceOfCreateChannelBookmarkRequest(value: object): value is CreateChannelBookmarkRequest;
export declare function CreateChannelBookmarkRequestFromJSON(json: any): CreateChannelBookmarkRequest;
export declare function CreateChannelBookmarkRequestFromJSONTyped(json: any, ignoreDiscriminator: boolean): CreateChannelBookmarkRequest;
export declare function CreateChannelBookmarkRequestToJSON(json: any): CreateChannelBookmarkRequest;
export declare function CreateChannelBookmarkRequestToJSONTyped(value?: CreateChannelBookmarkRequest | null, ignoreDiscriminator?: boolean): any;
