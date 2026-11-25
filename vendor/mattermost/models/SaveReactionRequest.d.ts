export interface SaveReactionRequest {
    userId: string;
    postId: string;
    emojiName: string;
}
export declare function instanceOfSaveReactionRequest(value: object): value is SaveReactionRequest;
export declare function SaveReactionRequestFromJSON(json: any): SaveReactionRequest;
export declare function SaveReactionRequestFromJSONTyped(json: any, ignoreDiscriminator: boolean): SaveReactionRequest;
export declare function SaveReactionRequestToJSON(json: any): SaveReactionRequest;
export declare function SaveReactionRequestToJSONTyped(value?: SaveReactionRequest | null, ignoreDiscriminator?: boolean): any;
