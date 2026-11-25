export interface ChannelMemberCountByGroup {
    groupId: string;
    channelMemberCount: number;
    channelMemberTimezonesCount: number;
}
export declare function instanceOfChannelMemberCountByGroup(value: object): value is ChannelMemberCountByGroup;
export declare function ChannelMemberCountByGroupFromJSON(json: any): ChannelMemberCountByGroup;
export declare function ChannelMemberCountByGroupFromJSONTyped(json: any, ignoreDiscriminator: boolean): ChannelMemberCountByGroup;
export declare function ChannelMemberCountByGroupToJSON(json: any): ChannelMemberCountByGroup;
export declare function ChannelMemberCountByGroupToJSONTyped(value?: ChannelMemberCountByGroup | null, ignoreDiscriminator?: boolean): any;
