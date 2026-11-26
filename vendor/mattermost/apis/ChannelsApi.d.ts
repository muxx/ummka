import * as runtime from '../runtime.js';
import { type AddChannelMemberRequest } from '../models/AddChannelMemberRequest.js';
import { type Channel } from '../models/Channel.js';
import { type ChannelMember } from '../models/ChannelMember.js';
import { type ChannelMemberCountByGroup } from '../models/ChannelMemberCountByGroup.js';
import { type ChannelNotifyProps } from '../models/ChannelNotifyProps.js';
import { type ChannelStats } from '../models/ChannelStats.js';
import { type MarkChannelsReadForUser200Response } from '../models/MarkChannelsReadForUser200Response.js';
import { type OrderedSidebarCategories } from '../models/OrderedSidebarCategories.js';
import { type PostList } from '../models/PostList.js';
import { type SidebarCategoryWithChannels } from '../models/SidebarCategoryWithChannels.js';
import { type StatusOK } from '../models/StatusOK.js';
import { type ViewChannel200Response } from '../models/ViewChannel200Response.js';
import { type ViewChannelRequest } from '../models/ViewChannelRequest.js';
export interface AddChannelMemberOperationRequest {
    channelId: string;
    addChannelMemberRequest: AddChannelMemberRequest;
}
export interface CreateSidebarCategoryForTeamForUserRequest {
    teamId: string;
    userId: string;
    sidebarCategoryWithChannels: SidebarCategoryWithChannels;
}
export interface GetChannelMemberRequest {
    channelId: string;
    userId: string;
}
export interface GetChannelMemberCountsByGroupRequest {
    channelId: string;
    includeTimezones?: boolean;
}
export interface GetChannelMembersRequest {
    channelId: string;
    page?: number;
    perPage?: number;
}
export interface GetChannelMembersByIdsRequest {
    channelId: string;
    requestBody: Array<string>;
}
export interface GetChannelMembersForUserRequest {
    userId: string;
    teamId: string;
}
export interface GetChannelMembersTimezonesRequest {
    channelId: string;
}
export interface GetChannelStatsRequest {
    channelId: string;
    excludeFilesCount?: boolean;
}
export interface GetChannelsForTeamForUserRequest {
    userId: string;
    teamId: string;
    includeDeleted?: boolean;
    lastDeleteAt?: number;
}
export interface GetPinnedPostsRequest {
    channelId: string;
}
export interface GetSidebarCategoriesForTeamForUserRequest {
    teamId: string;
    userId: string;
}
export interface MarkChannelsReadForUserRequest {
    userId: string;
    requestBody: Array<string>;
}
export interface RemoveSidebarCategoryForTeamForUserRequest {
    teamId: string;
    userId: string;
    categoryId: string;
}
export interface RemoveUserFromChannelRequest {
    channelId: string;
    userId: string;
}
export interface UpdateChannelNotifyPropsRequest {
    channelId: string;
    userId: string;
    channelNotifyProps: ChannelNotifyProps;
}
export interface UpdateSidebarCategoriesForTeamForUserRequest {
    teamId: string;
    userId: string;
    sidebarCategoryWithChannels: Array<SidebarCategoryWithChannels>;
}
export interface UpdateSidebarCategoryForTeamForUserRequest {
    teamId: string;
    userId: string;
    categoryId: string;
    sidebarCategoryWithChannels: SidebarCategoryWithChannels;
}
export interface UpdateSidebarCategoryOrderForTeamForUserRequest {
    teamId: string;
    userId: string;
    requestBody: Array<string>;
}
export interface ViewChannelOperationRequest {
    userId: string;
    viewChannelRequest: ViewChannelRequest;
}
export declare class ChannelsApi extends runtime.BaseAPI {
    addChannelMemberRequestOpts(requestParameters: AddChannelMemberOperationRequest): Promise<runtime.RequestOpts>;
    addChannelMemberRaw(requestParameters: AddChannelMemberOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ChannelMember>>;
    addChannelMember(requestParameters: AddChannelMemberOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ChannelMember>;
    createSidebarCategoryForTeamForUserRequestOpts(requestParameters: CreateSidebarCategoryForTeamForUserRequest): Promise<runtime.RequestOpts>;
    createSidebarCategoryForTeamForUserRaw(requestParameters: CreateSidebarCategoryForTeamForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<SidebarCategoryWithChannels>>;
    createSidebarCategoryForTeamForUser(requestParameters: CreateSidebarCategoryForTeamForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<SidebarCategoryWithChannels>;
    getChannelMemberRequestOpts(requestParameters: GetChannelMemberRequest): Promise<runtime.RequestOpts>;
    getChannelMemberRaw(requestParameters: GetChannelMemberRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ChannelMember>>;
    getChannelMember(requestParameters: GetChannelMemberRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ChannelMember>;
    getChannelMemberCountsByGroupRequestOpts(requestParameters: GetChannelMemberCountsByGroupRequest): Promise<runtime.RequestOpts>;
    getChannelMemberCountsByGroupRaw(requestParameters: GetChannelMemberCountsByGroupRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<ChannelMemberCountByGroup>>>;
    getChannelMemberCountsByGroup(requestParameters: GetChannelMemberCountsByGroupRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<ChannelMemberCountByGroup>>;
    getChannelMembersRequestOpts(requestParameters: GetChannelMembersRequest): Promise<runtime.RequestOpts>;
    getChannelMembersRaw(requestParameters: GetChannelMembersRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<ChannelMember>>>;
    getChannelMembers(requestParameters: GetChannelMembersRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<ChannelMember>>;
    getChannelMembersByIdsRequestOpts(requestParameters: GetChannelMembersByIdsRequest): Promise<runtime.RequestOpts>;
    getChannelMembersByIdsRaw(requestParameters: GetChannelMembersByIdsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<ChannelMember>>>;
    getChannelMembersByIds(requestParameters: GetChannelMembersByIdsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<ChannelMember>>;
    getChannelMembersForUserRequestOpts(requestParameters: GetChannelMembersForUserRequest): Promise<runtime.RequestOpts>;
    getChannelMembersForUserRaw(requestParameters: GetChannelMembersForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<ChannelMember>>>;
    getChannelMembersForUser(requestParameters: GetChannelMembersForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<ChannelMember>>;
    getChannelMembersTimezonesRequestOpts(requestParameters: GetChannelMembersTimezonesRequest): Promise<runtime.RequestOpts>;
    getChannelMembersTimezonesRaw(requestParameters: GetChannelMembersTimezonesRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<string> | null>>;
    getChannelMembersTimezones(requestParameters: GetChannelMembersTimezonesRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<string> | null>;
    getChannelStatsRequestOpts(requestParameters: GetChannelStatsRequest): Promise<runtime.RequestOpts>;
    getChannelStatsRaw(requestParameters: GetChannelStatsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ChannelStats>>;
    getChannelStats(requestParameters: GetChannelStatsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ChannelStats>;
    getChannelsForTeamForUserRequestOpts(requestParameters: GetChannelsForTeamForUserRequest): Promise<runtime.RequestOpts>;
    getChannelsForTeamForUserRaw(requestParameters: GetChannelsForTeamForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<Channel>>>;
    getChannelsForTeamForUser(requestParameters: GetChannelsForTeamForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<Channel>>;
    getPinnedPostsRequestOpts(requestParameters: GetPinnedPostsRequest): Promise<runtime.RequestOpts>;
    getPinnedPostsRaw(requestParameters: GetPinnedPostsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<PostList>>;
    getPinnedPosts(requestParameters: GetPinnedPostsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<PostList>;
    getSidebarCategoriesForTeamForUserRequestOpts(requestParameters: GetSidebarCategoriesForTeamForUserRequest): Promise<runtime.RequestOpts>;
    getSidebarCategoriesForTeamForUserRaw(requestParameters: GetSidebarCategoriesForTeamForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<OrderedSidebarCategories>>;
    getSidebarCategoriesForTeamForUser(requestParameters: GetSidebarCategoriesForTeamForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<OrderedSidebarCategories>;
    markChannelsReadForUserRequestOpts(requestParameters: MarkChannelsReadForUserRequest): Promise<runtime.RequestOpts>;
    markChannelsReadForUserRaw(requestParameters: MarkChannelsReadForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<MarkChannelsReadForUser200Response>>;
    markChannelsReadForUser(requestParameters: MarkChannelsReadForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<MarkChannelsReadForUser200Response>;
    removeSidebarCategoryForTeamForUserRequestOpts(requestParameters: RemoveSidebarCategoryForTeamForUserRequest): Promise<runtime.RequestOpts>;
    removeSidebarCategoryForTeamForUserRaw(requestParameters: RemoveSidebarCategoryForTeamForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<StatusOK>>;
    removeSidebarCategoryForTeamForUser(requestParameters: RemoveSidebarCategoryForTeamForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<StatusOK>;
    removeUserFromChannelRequestOpts(requestParameters: RemoveUserFromChannelRequest): Promise<runtime.RequestOpts>;
    removeUserFromChannelRaw(requestParameters: RemoveUserFromChannelRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<StatusOK>>;
    removeUserFromChannel(requestParameters: RemoveUserFromChannelRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<StatusOK>;
    updateChannelNotifyPropsRequestOpts(requestParameters: UpdateChannelNotifyPropsRequest): Promise<runtime.RequestOpts>;
    updateChannelNotifyPropsRaw(requestParameters: UpdateChannelNotifyPropsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<StatusOK>>;
    updateChannelNotifyProps(requestParameters: UpdateChannelNotifyPropsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<StatusOK>;
    updateSidebarCategoriesForTeamForUserRequestOpts(requestParameters: UpdateSidebarCategoriesForTeamForUserRequest): Promise<runtime.RequestOpts>;
    updateSidebarCategoriesForTeamForUserRaw(requestParameters: UpdateSidebarCategoriesForTeamForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<SidebarCategoryWithChannels>>>;
    updateSidebarCategoriesForTeamForUser(requestParameters: UpdateSidebarCategoriesForTeamForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<SidebarCategoryWithChannels>>;
    updateSidebarCategoryForTeamForUserRequestOpts(requestParameters: UpdateSidebarCategoryForTeamForUserRequest): Promise<runtime.RequestOpts>;
    updateSidebarCategoryForTeamForUserRaw(requestParameters: UpdateSidebarCategoryForTeamForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<SidebarCategoryWithChannels>>;
    updateSidebarCategoryForTeamForUser(requestParameters: UpdateSidebarCategoryForTeamForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<SidebarCategoryWithChannels>;
    updateSidebarCategoryOrderForTeamForUserRequestOpts(requestParameters: UpdateSidebarCategoryOrderForTeamForUserRequest): Promise<runtime.RequestOpts>;
    updateSidebarCategoryOrderForTeamForUserRaw(requestParameters: UpdateSidebarCategoryOrderForTeamForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<string>>>;
    updateSidebarCategoryOrderForTeamForUser(requestParameters: UpdateSidebarCategoryOrderForTeamForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<string>>;
    viewChannelRequestOpts(requestParameters: ViewChannelOperationRequest): Promise<runtime.RequestOpts>;
    viewChannelRaw(requestParameters: ViewChannelOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ViewChannel200Response>>;
    viewChannel(requestParameters: ViewChannelOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ViewChannel200Response>;
}
