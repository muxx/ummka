import * as runtime from '../runtime.js';
import { type StatusOK } from '../models/StatusOK.js';
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
    startFollowingThreadRequestOpts(requestParameters: StartFollowingThreadRequest): Promise<runtime.RequestOpts>;
    startFollowingThreadRaw(requestParameters: StartFollowingThreadRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<StatusOK>>;
    startFollowingThread(requestParameters: StartFollowingThreadRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<StatusOK>;
    stopFollowingThreadRequestOpts(requestParameters: StopFollowingThreadRequest): Promise<runtime.RequestOpts>;
    stopFollowingThreadRaw(requestParameters: StopFollowingThreadRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<StatusOK>>;
    stopFollowingThread(requestParameters: StopFollowingThreadRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<StatusOK>;
}
