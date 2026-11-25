export interface CreatePostRequestMetadataPriority {
    priority?: string;
    requestedAck?: boolean;
}
export declare function instanceOfCreatePostRequestMetadataPriority(value: object): value is CreatePostRequestMetadataPriority;
export declare function CreatePostRequestMetadataPriorityFromJSON(json: any): CreatePostRequestMetadataPriority;
export declare function CreatePostRequestMetadataPriorityFromJSONTyped(json: any, ignoreDiscriminator: boolean): CreatePostRequestMetadataPriority;
export declare function CreatePostRequestMetadataPriorityToJSON(json: any): CreatePostRequestMetadataPriority;
export declare function CreatePostRequestMetadataPriorityToJSONTyped(value?: CreatePostRequestMetadataPriority | null, ignoreDiscriminator?: boolean): any;
