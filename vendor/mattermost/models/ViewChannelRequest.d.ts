export interface ViewChannelRequest {
    channelId: string;
    prevChannelId?: string;
    collapsedThreadsSupported?: boolean;
}
export declare function instanceOfViewChannelRequest(value: object): value is ViewChannelRequest;
export declare function ViewChannelRequestFromJSON(json: any): ViewChannelRequest;
export declare function ViewChannelRequestFromJSONTyped(json: any, ignoreDiscriminator: boolean): ViewChannelRequest;
export declare function ViewChannelRequestToJSON(json: any): ViewChannelRequest;
export declare function ViewChannelRequestToJSONTyped(value?: ViewChannelRequest | null, ignoreDiscriminator?: boolean): any;
