import type { CreatePostRequestMetadataPriority } from './CreatePostRequestMetadataPriority.js';
export interface CreatePostRequestMetadata {
    priority?: CreatePostRequestMetadataPriority;
}
export declare function instanceOfCreatePostRequestMetadata(value: object): value is CreatePostRequestMetadata;
export declare function CreatePostRequestMetadataFromJSON(json: any): CreatePostRequestMetadata;
export declare function CreatePostRequestMetadataFromJSONTyped(json: any, ignoreDiscriminator: boolean): CreatePostRequestMetadata;
export declare function CreatePostRequestMetadataToJSON(json: any): CreatePostRequestMetadata;
export declare function CreatePostRequestMetadataToJSONTyped(value?: CreatePostRequestMetadata | null, ignoreDiscriminator?: boolean): any;
