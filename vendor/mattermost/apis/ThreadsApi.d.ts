import * as runtime from '../runtime.js';
import { type StatusOK } from '../models/StatusOK.js';
import { type UserThread } from '../models/UserThread.js';
import { type UserThreads } from '../models/UserThreads.js';
export interface GetUserThreadsRequest {
    userId: string;
    teamId: string;
    since?: number;
    deleted?: boolean;
    extended?: boolean;
    perPage?: number;
    totalsOnly?: boolean;
    threadsOnly?: boolean;
    before?: string;
    after?: string;
    unread?: boolean;
    excludeDirect?: boolean;
}
export interface SetThreadUnreadByPostIdRequest {
    userId: string;
    teamId: string;
    threadId: string;
    postId: string;
}
export interface StartFollowingThreadRequest {
    userId: string;
    teamId: string;
    threadId: string;
}
export interface StopFollowingThreadRequest {
    userId: string;
    teamId: string;
    threadId: string;
}
export interface UpdateThreadReadForUserRequest {
    userId: string;
    teamId: string;
    threadId: string;
    timestamp: number;
}
export interface UpdateThreadsReadForUserRequest {
    userId: string;
    teamId: string;
}
export declare class ThreadsApi extends runtime.BaseAPI {
    getUserThreadsRequestOpts(requestParameters: GetUserThreadsRequest): Promise<runtime.RequestOpts>;
    getUserThreadsRaw(requestParameters: GetUserThreadsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<UserThreads>>;
    getUserThreads(requestParameters: GetUserThreadsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<UserThreads>;
    setThreadUnreadByPostIdRequestOpts(requestParameters: SetThreadUnreadByPostIdRequest): Promise<runtime.RequestOpts>;
    setThreadUnreadByPostIdRaw(requestParameters: SetThreadUnreadByPostIdRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<UserThread>>;
    setThreadUnreadByPostId(requestParameters: SetThreadUnreadByPostIdRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<UserThread>;
    startFollowingThreadRequestOpts(requestParameters: StartFollowingThreadRequest): Promise<runtime.RequestOpts>;
    startFollowingThreadRaw(requestParameters: StartFollowingThreadRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<StatusOK>>;
    startFollowingThread(requestParameters: StartFollowingThreadRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<StatusOK>;
    stopFollowingThreadRequestOpts(requestParameters: StopFollowingThreadRequest): Promise<runtime.RequestOpts>;
    stopFollowingThreadRaw(requestParameters: StopFollowingThreadRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<StatusOK>>;
    stopFollowingThread(requestParameters: StopFollowingThreadRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<StatusOK>;
    updateThreadReadForUserRequestOpts(requestParameters: UpdateThreadReadForUserRequest): Promise<runtime.RequestOpts>;
    updateThreadReadForUserRaw(requestParameters: UpdateThreadReadForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<UserThread>>;
    updateThreadReadForUser(requestParameters: UpdateThreadReadForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<UserThread>;
    updateThreadsReadForUserRequestOpts(requestParameters: UpdateThreadsReadForUserRequest): Promise<runtime.RequestOpts>;
    updateThreadsReadForUserRaw(requestParameters: UpdateThreadsReadForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<StatusOK>>;
    updateThreadsReadForUser(requestParameters: UpdateThreadsReadForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<StatusOK>;
}
