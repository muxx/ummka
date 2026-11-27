import type { ChannelBookmarkWithFileInfo } from './ChannelBookmarkWithFileInfo.js';
export interface UpdateChannelBookmarkResponse {
    updated?: ChannelBookmarkWithFileInfo;
    deleted?: ChannelBookmarkWithFileInfo;
}
export declare function instanceOfUpdateChannelBookmarkResponse(value: object): value is UpdateChannelBookmarkResponse;
export declare function UpdateChannelBookmarkResponseFromJSON(json: any): UpdateChannelBookmarkResponse;
export declare function UpdateChannelBookmarkResponseFromJSONTyped(json: any, ignoreDiscriminator: boolean): UpdateChannelBookmarkResponse;
export declare function UpdateChannelBookmarkResponseToJSON(json: any): UpdateChannelBookmarkResponse;
export declare function UpdateChannelBookmarkResponseToJSONTyped(value?: UpdateChannelBookmarkResponse | null, ignoreDiscriminator?: boolean): any;
