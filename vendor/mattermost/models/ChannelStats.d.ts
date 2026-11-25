export interface ChannelStats {
    channelId: string;
    memberCount: number;
    guestCount: number;
    pinnedpostCount: number;
    filesCount: number;
}
export declare function instanceOfChannelStats(value: object): value is ChannelStats;
export declare function ChannelStatsFromJSON(json: any): ChannelStats;
export declare function ChannelStatsFromJSONTyped(json: any, ignoreDiscriminator: boolean): ChannelStats;
export declare function ChannelStatsToJSON(json: any): ChannelStats;
export declare function ChannelStatsToJSONTyped(value?: ChannelStats | null, ignoreDiscriminator?: boolean): any;
