export interface PostInfo {
    channelId?: string;
    channelType?: string;
    channelDisplayName?: string;
    hasJoinedChannel?: boolean;
    teamId?: string;
    teamType?: string;
    teamDisplayName?: string;
    hasJoinedTeam?: boolean;
}
export declare function instanceOfPostInfo(value: object): value is PostInfo;
export declare function PostInfoFromJSON(json: any): PostInfo;
export declare function PostInfoFromJSONTyped(json: any, ignoreDiscriminator: boolean): PostInfo;
export declare function PostInfoToJSON(json: any): PostInfo;
export declare function PostInfoToJSONTyped(value?: PostInfo | null, ignoreDiscriminator?: boolean): any;
