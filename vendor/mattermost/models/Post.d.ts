import type { User } from './User.js';
import type { PostMetadata } from './PostMetadata.js';
export interface Post {
    id?: string;
    createAt?: number;
    updateAt?: number;
    deleteAt?: number;
    editAt?: number;
    userId?: string;
    channelId?: string;
    rootId?: string;
    originalId?: string;
    message?: string;
    type?: string;
    props?: object;
    hashtag?: string;
    fileIds?: Array<string>;
    pendingPostId?: string;
    metadata?: PostMetadata;
    replyCount?: number;
    lastReplyAt?: number;
    participants?: Array<User> | null;
    isFollowing?: boolean;
}
export declare function instanceOfPost(value: object): value is Post;
export declare function PostFromJSON(json: any): Post;
export declare function PostFromJSONTyped(json: any, ignoreDiscriminator: boolean): Post;
export declare function PostToJSON(json: any): Post;
export declare function PostToJSONTyped(value?: Post | null, ignoreDiscriminator?: boolean): any;
