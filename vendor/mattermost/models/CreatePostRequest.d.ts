import type { CreatePostRequestMetadata } from './CreatePostRequestMetadata.js';
export interface CreatePostRequest {
    channelId: string;
    message: string;
    rootId?: string;
    fileIds?: Array<string>;
    props?: object;
    metadata?: CreatePostRequestMetadata;
    pendingPostId?: string;
}
export declare function instanceOfCreatePostRequest(value: object): value is CreatePostRequest;
export declare function CreatePostRequestFromJSON(json: any): CreatePostRequest;
export declare function CreatePostRequestFromJSONTyped(json: any, ignoreDiscriminator: boolean): CreatePostRequest;
export declare function CreatePostRequestToJSON(json: any): CreatePostRequest;
export declare function CreatePostRequestToJSONTyped(value?: CreatePostRequest | null, ignoreDiscriminator?: boolean): any;
