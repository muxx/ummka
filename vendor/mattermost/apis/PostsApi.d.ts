import * as runtime from '../runtime.js';
import { type PostList } from '../models/PostList.js';
export interface GetPostsForChannelRequest {
    channelId: string;
    page?: number;
    perPage?: number;
    since?: number;
    before?: string;
    after?: string;
    includeDeleted?: boolean;
    skipFetchThreads?: boolean;
    collapsedThreads?: boolean;
    collapsedThreadsExtended?: boolean;
}
export declare class PostsApi extends runtime.BaseAPI {
    getPostsForChannelRequestOpts(requestParameters: GetPostsForChannelRequest): Promise<runtime.RequestOpts>;
    getPostsForChannelRaw(requestParameters: GetPostsForChannelRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<PostList>>;
    getPostsForChannel(requestParameters: GetPostsForChannelRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<PostList>;
}
