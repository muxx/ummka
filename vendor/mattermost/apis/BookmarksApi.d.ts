import * as runtime from '../runtime.js';
import { type ChannelBookmarkWithFileInfo } from '../models/ChannelBookmarkWithFileInfo.js';
export interface ListChannelBookmarksForChannelRequest {
    channelId: string;
    bookmarksSince?: number;
}
export declare class BookmarksApi extends runtime.BaseAPI {
    listChannelBookmarksForChannelRequestOpts(requestParameters: ListChannelBookmarksForChannelRequest): Promise<runtime.RequestOpts>;
    listChannelBookmarksForChannelRaw(requestParameters: ListChannelBookmarksForChannelRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<ChannelBookmarkWithFileInfo>>>;
    listChannelBookmarksForChannel(requestParameters: ListChannelBookmarksForChannelRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<ChannelBookmarkWithFileInfo>>;
}
