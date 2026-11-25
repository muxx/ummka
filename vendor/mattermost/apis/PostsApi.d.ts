import * as runtime from '../runtime.js';
import { type ChannelUnreadAt } from '../models/ChannelUnreadAt.js';
import { type CreatePostRequest } from '../models/CreatePostRequest.js';
import { type PatchPostRequest } from '../models/PatchPostRequest.js';
import { type Post } from '../models/Post.js';
import { type PostInfo } from '../models/PostInfo.js';
import { type PostList } from '../models/PostList.js';
import { type SetPostUnreadRequest } from '../models/SetPostUnreadRequest.js';
import { type StatusOK } from '../models/StatusOK.js';
export interface CreatePostOperationRequest {
    createPostRequest: CreatePostRequest;
    setOnline?: boolean;
}
export interface DeletePostRequest {
    postId: string;
}
export interface GetPostInfoRequest {
    postId: string;
}
export interface GetPostThreadRequest {
    postId: string;
    perPage?: number;
    fromPost?: string;
    fromCreateAt?: number;
    fromUpdateAt?: number;
    direction?: string;
    skipFetchThreads?: boolean;
    collapsedThreads?: boolean;
    collapsedThreadsExtended?: boolean;
    updatesOnly?: boolean;
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
export interface PatchPostOperationRequest {
    postId: string;
    patchPostRequest: PatchPostRequest;
}
export interface SetPostUnreadOperationRequest {
    userId: string;
    postId: string;
    setPostUnreadRequest: SetPostUnreadRequest;
}
export declare class PostsApi extends runtime.BaseAPI {
    createPostRequestOpts(requestParameters: CreatePostOperationRequest): Promise<runtime.RequestOpts>;
    createPostRaw(requestParameters: CreatePostOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Post>>;
    createPost(requestParameters: CreatePostOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Post>;
    deletePostRequestOpts(requestParameters: DeletePostRequest): Promise<runtime.RequestOpts>;
    deletePostRaw(requestParameters: DeletePostRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<StatusOK>>;
    deletePost(requestParameters: DeletePostRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<StatusOK>;
    getPostInfoRequestOpts(requestParameters: GetPostInfoRequest): Promise<runtime.RequestOpts>;
    getPostInfoRaw(requestParameters: GetPostInfoRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<PostInfo>>;
    getPostInfo(requestParameters: GetPostInfoRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<PostInfo>;
    getPostThreadRequestOpts(requestParameters: GetPostThreadRequest): Promise<runtime.RequestOpts>;
    getPostThreadRaw(requestParameters: GetPostThreadRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<PostList>>;
    getPostThread(requestParameters: GetPostThreadRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<PostList>;
    getPostsForChannelRequestOpts(requestParameters: GetPostsForChannelRequest): Promise<runtime.RequestOpts>;
    getPostsForChannelRaw(requestParameters: GetPostsForChannelRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<PostList>>;
    getPostsForChannel(requestParameters: GetPostsForChannelRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<PostList>;
    patchPostRequestOpts(requestParameters: PatchPostOperationRequest): Promise<runtime.RequestOpts>;
    patchPostRaw(requestParameters: PatchPostOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Post>>;
    patchPost(requestParameters: PatchPostOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Post>;
    setPostUnreadRequestOpts(requestParameters: SetPostUnreadOperationRequest): Promise<runtime.RequestOpts>;
    setPostUnreadRaw(requestParameters: SetPostUnreadOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ChannelUnreadAt>>;
    setPostUnread(requestParameters: SetPostUnreadOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ChannelUnreadAt>;
}
