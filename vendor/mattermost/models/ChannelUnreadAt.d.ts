export interface ChannelUnreadAt {
    teamId?: string;
    channelId?: string;
    msgCount?: number;
    mentionCount?: number;
    lastViewedAt?: number;
    userId?: string;
    msgCountRoot?: number;
    mentionCountRoot?: number;
    urgentMentionCount?: number;
}
export declare function instanceOfChannelUnreadAt(value: object): value is ChannelUnreadAt;
export declare function ChannelUnreadAtFromJSON(json: any): ChannelUnreadAt;
export declare function ChannelUnreadAtFromJSONTyped(json: any, ignoreDiscriminator: boolean): ChannelUnreadAt;
export declare function ChannelUnreadAtToJSON(json: any): ChannelUnreadAt;
export declare function ChannelUnreadAtToJSONTyped(value?: ChannelUnreadAt | null, ignoreDiscriminator?: boolean): any;
