import * as runtime from '../runtime.js';
import { type StatusOK } from '../models/StatusOK.js';
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
export declare class ThreadsApi extends runtime.BaseAPI {
    getUserThreadsRequestOpts(requestParameters: GetUserThreadsRequest): Promise<runtime.RequestOpts>;
    getUserThreadsRaw(requestParameters: GetUserThreadsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<UserThreads>>;
    getUserThreads(requestParameters: GetUserThreadsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<UserThreads>;
    startFollowingThreadRequestOpts(requestParameters: StartFollowingThreadRequest): Promise<runtime.RequestOpts>;
    startFollowingThreadRaw(requestParameters: StartFollowingThreadRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<StatusOK>>;
    startFollowingThread(requestParameters: StartFollowingThreadRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<StatusOK>;
    stopFollowingThreadRequestOpts(requestParameters: StopFollowingThreadRequest): Promise<runtime.RequestOpts>;
    stopFollowingThreadRaw(requestParameters: StopFollowingThreadRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<StatusOK>>;
    stopFollowingThread(requestParameters: StopFollowingThreadRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<StatusOK>;
}
