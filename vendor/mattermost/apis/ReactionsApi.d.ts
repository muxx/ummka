import * as runtime from '../runtime.js';
import { type Reaction } from '../models/Reaction.js';
export interface GetReactionsRequest {
    postId: string;
}
export declare class ReactionsApi extends runtime.BaseAPI {
    getReactionsRequestOpts(requestParameters: GetReactionsRequest): Promise<runtime.RequestOpts>;
    getReactionsRaw(requestParameters: GetReactionsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<Reaction> | null>>;
    getReactions(requestParameters: GetReactionsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<Reaction> | null>;
}
