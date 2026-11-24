import type { Post } from './Post.js';
export interface PostList {
    order?: Array<string>;
    posts?: {
        [key: string]: Post;
    };
    nextPostId?: string;
    prevPostId?: string;
    hasNext?: boolean;
    firstInaccessiblePostTime?: number;
}
export declare function instanceOfPostList(value: object): value is PostList;
export declare function PostListFromJSON(json: any): PostList;
export declare function PostListFromJSONTyped(json: any, ignoreDiscriminator: boolean): PostList;
export declare function PostListToJSON(json: any): PostList;
export declare function PostListToJSONTyped(value?: PostList | null, ignoreDiscriminator?: boolean): any;
