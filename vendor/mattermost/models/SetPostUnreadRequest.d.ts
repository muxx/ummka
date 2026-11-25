export interface SetPostUnreadRequest {
    collapsedThreadsSupported: boolean;
}
export declare function instanceOfSetPostUnreadRequest(value: object): value is SetPostUnreadRequest;
export declare function SetPostUnreadRequestFromJSON(json: any): SetPostUnreadRequest;
export declare function SetPostUnreadRequestFromJSONTyped(json: any, ignoreDiscriminator: boolean): SetPostUnreadRequest;
export declare function SetPostUnreadRequestToJSON(json: any): SetPostUnreadRequest;
export declare function SetPostUnreadRequestToJSONTyped(value?: SetPostUnreadRequest | null, ignoreDiscriminator?: boolean): any;
