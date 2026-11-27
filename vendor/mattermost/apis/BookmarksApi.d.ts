import * as runtime from '../runtime.js';
import { type ChannelBookmarkWithFileInfo } from '../models/ChannelBookmarkWithFileInfo.js';
import { type CreateChannelBookmarkRequest } from '../models/CreateChannelBookmarkRequest.js';
import { type UpdateChannelBookmarkRequest } from '../models/UpdateChannelBookmarkRequest.js';
import { type UpdateChannelBookmarkResponse } from '../models/UpdateChannelBookmarkResponse.js';
export interface CreateChannelBookmarkOperationRequest {
    channelId: string;
    createChannelBookmarkRequest: CreateChannelBookmarkRequest;
    connectionId?: string;
}
export interface DeleteChannelBookmarkRequest {
    channelId: string;
    bookmarkId: string;
    connectionId?: string;
}
export interface ListChannelBookmarksForChannelRequest {
    channelId: string;
    bookmarksSince?: number;
}
export interface UpdateChannelBookmarkOperationRequest {
    channelId: string;
    bookmarkId: string;
    updateChannelBookmarkRequest: UpdateChannelBookmarkRequest;
    connectionId?: string;
}
export interface UpdateChannelBookmarkSortOrderRequest {
    channelId: string;
    bookmarkId: string;
    body: number;
    connectionId?: string;
}
export declare class BookmarksApi extends runtime.BaseAPI {
    createChannelBookmarkRequestOpts(requestParameters: CreateChannelBookmarkOperationRequest): Promise<runtime.RequestOpts>;
    createChannelBookmarkRaw(requestParameters: CreateChannelBookmarkOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ChannelBookmarkWithFileInfo>>;
    createChannelBookmark(requestParameters: CreateChannelBookmarkOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ChannelBookmarkWithFileInfo>;
    deleteChannelBookmarkRequestOpts(requestParameters: DeleteChannelBookmarkRequest): Promise<runtime.RequestOpts>;
    deleteChannelBookmarkRaw(requestParameters: DeleteChannelBookmarkRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ChannelBookmarkWithFileInfo>>;
    deleteChannelBookmark(requestParameters: DeleteChannelBookmarkRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ChannelBookmarkWithFileInfo>;
    listChannelBookmarksForChannelRequestOpts(requestParameters: ListChannelBookmarksForChannelRequest): Promise<runtime.RequestOpts>;
    listChannelBookmarksForChannelRaw(requestParameters: ListChannelBookmarksForChannelRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<ChannelBookmarkWithFileInfo>>>;
    listChannelBookmarksForChannel(requestParameters: ListChannelBookmarksForChannelRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<ChannelBookmarkWithFileInfo>>;
    updateChannelBookmarkRequestOpts(requestParameters: UpdateChannelBookmarkOperationRequest): Promise<runtime.RequestOpts>;
    updateChannelBookmarkRaw(requestParameters: UpdateChannelBookmarkOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<UpdateChannelBookmarkResponse>>;
    updateChannelBookmark(requestParameters: UpdateChannelBookmarkOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<UpdateChannelBookmarkResponse>;
    updateChannelBookmarkSortOrderRequestOpts(requestParameters: UpdateChannelBookmarkSortOrderRequest): Promise<runtime.RequestOpts>;
    updateChannelBookmarkSortOrderRaw(requestParameters: UpdateChannelBookmarkSortOrderRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<ChannelBookmarkWithFileInfo>>>;
    updateChannelBookmarkSortOrder(requestParameters: UpdateChannelBookmarkSortOrderRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<ChannelBookmarkWithFileInfo>>;
}
