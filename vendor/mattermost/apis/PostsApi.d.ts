import * as runtime from '../runtime.js';
import { type PostInfo } from '../models/PostInfo.js';
import { type PostList } from '../models/PostList.js';
export interface GetPostInfoRequest {
    postId: string;
}
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
    getPostInfoRequestOpts(requestParameters: GetPostInfoRequest): Promise<runtime.RequestOpts>;
    getPostInfoRaw(requestParameters: GetPostInfoRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<PostInfo>>;
    getPostInfo(requestParameters: GetPostInfoRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<PostInfo>;
    getPostsForChannelRequestOpts(requestParameters: GetPostsForChannelRequest): Promise<runtime.RequestOpts>;
    getPostsForChannelRaw(requestParameters: GetPostsForChannelRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<PostList>>;
    getPostsForChannel(requestParameters: GetPostsForChannelRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<PostList>;
}
