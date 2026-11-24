export interface PostAcknowledgement {
    userId?: string;
    postId?: string;
    acknowledgedAt?: number;
}
export declare function instanceOfPostAcknowledgement(value: object): value is PostAcknowledgement;
export declare function PostAcknowledgementFromJSON(json: any): PostAcknowledgement;
export declare function PostAcknowledgementFromJSONTyped(json: any, ignoreDiscriminator: boolean): PostAcknowledgement;
export declare function PostAcknowledgementToJSON(json: any): PostAcknowledgement;
export declare function PostAcknowledgementToJSONTyped(value?: PostAcknowledgement | null, ignoreDiscriminator?: boolean): any;
