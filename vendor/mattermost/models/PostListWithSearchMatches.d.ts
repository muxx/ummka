import type { Post } from './Post.js';
export interface PostListWithSearchMatches {
    order: Array<string>;
    posts: {
        [key: string]: Post;
    };
    nextPostId: string;
    prevPostId: string;
    hasNext?: boolean;
    firstInaccessiblePostTime: number;
    matches: {
        [key: string]: Array<string>;
    } | null;
}
export declare function instanceOfPostListWithSearchMatches(value: object): value is PostListWithSearchMatches;
export declare function PostListWithSearchMatchesFromJSON(json: any): PostListWithSearchMatches;
export declare function PostListWithSearchMatchesFromJSONTyped(json: any, ignoreDiscriminator: boolean): PostListWithSearchMatches;
export declare function PostListWithSearchMatchesToJSON(json: any): PostListWithSearchMatches;
export declare function PostListWithSearchMatchesToJSONTyped(value?: PostListWithSearchMatches | null, ignoreDiscriminator?: boolean): any;
