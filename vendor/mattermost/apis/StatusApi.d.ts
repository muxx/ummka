import * as runtime from '../runtime.js';
import { type Status } from '../models/Status.js';
export interface GetUsersStatusesByIdsRequest {
    requestBody: Array<string>;
}
export declare class StatusApi extends runtime.BaseAPI {
    getUsersStatusesByIdsRequestOpts(requestParameters: GetUsersStatusesByIdsRequest): Promise<runtime.RequestOpts>;
    getUsersStatusesByIdsRaw(requestParameters: GetUsersStatusesByIdsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<Status>>>;
    getUsersStatusesByIds(requestParameters: GetUsersStatusesByIdsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<Status>>;
}
