export interface PostMetadataPriority {
    priority?: string;
    requestedAck?: boolean;
}
export declare function instanceOfPostMetadataPriority(value: object): value is PostMetadataPriority;
export declare function PostMetadataPriorityFromJSON(json: any): PostMetadataPriority;
export declare function PostMetadataPriorityFromJSONTyped(json: any, ignoreDiscriminator: boolean): PostMetadataPriority;
export declare function PostMetadataPriorityToJSON(json: any): PostMetadataPriority;
export declare function PostMetadataPriorityToJSONTyped(value?: PostMetadataPriority | null, ignoreDiscriminator?: boolean): any;
