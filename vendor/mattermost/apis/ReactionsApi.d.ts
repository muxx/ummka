import * as runtime from '../runtime.js';
import { type Reaction } from '../models/Reaction.js';
import { type SaveReactionRequest } from '../models/SaveReactionRequest.js';
import { type StatusOK } from '../models/StatusOK.js';
export interface DeleteReactionRequest {
    userId: string;
    postId: string;
    emojiName: string;
}
export interface GetReactionsRequest {
    postId: string;
}
export interface SaveReactionOperationRequest {
    saveReactionRequest: SaveReactionRequest;
}
export declare class ReactionsApi extends runtime.BaseAPI {
    deleteReactionRequestOpts(requestParameters: DeleteReactionRequest): Promise<runtime.RequestOpts>;
    deleteReactionRaw(requestParameters: DeleteReactionRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<StatusOK>>;
    deleteReaction(requestParameters: DeleteReactionRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<StatusOK>;
    getReactionsRequestOpts(requestParameters: GetReactionsRequest): Promise<runtime.RequestOpts>;
    getReactionsRaw(requestParameters: GetReactionsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<Reaction> | null>>;
    getReactions(requestParameters: GetReactionsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<Reaction> | null>;
    saveReactionRequestOpts(requestParameters: SaveReactionOperationRequest): Promise<runtime.RequestOpts>;
    saveReactionRaw(requestParameters: SaveReactionOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Reaction>>;
    saveReaction(requestParameters: SaveReactionOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Reaction>;
}
