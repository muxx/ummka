export interface AddChannelMemberRequest {
    userId: string;
    postRootId?: string;
}
export declare function instanceOfAddChannelMemberRequest(value: object): value is AddChannelMemberRequest;
export declare function AddChannelMemberRequestFromJSON(json: any): AddChannelMemberRequest;
export declare function AddChannelMemberRequestFromJSONTyped(json: any, ignoreDiscriminator: boolean): AddChannelMemberRequest;
export declare function AddChannelMemberRequestToJSON(json: any): AddChannelMemberRequest;
export declare function AddChannelMemberRequestToJSONTyped(value?: AddChannelMemberRequest | null, ignoreDiscriminator?: boolean): any;
