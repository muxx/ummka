import type { ChannelNotifyProps } from './ChannelNotifyProps.js';
export interface ChannelMember {
    channelId?: string;
    userId?: string;
    roles?: string;
    lastViewedAt?: number;
    msgCount?: number;
    mentionCount?: number;
    notifyProps?: ChannelNotifyProps;
    lastUpdateAt?: number;
    schemeGuest?: boolean;
    schemeUser?: boolean;
    schemeAdmin?: boolean;
    explicitRoles?: string;
    msgCountRoot?: number;
    mentionCountRoot?: number;
    urgentMentionCount?: number;
}
export declare function instanceOfChannelMember(value: object): value is ChannelMember;
export declare function ChannelMemberFromJSON(json: any): ChannelMember;
export declare function ChannelMemberFromJSONTyped(json: any, ignoreDiscriminator: boolean): ChannelMember;
export declare function ChannelMemberToJSON(json: any): ChannelMember;
export declare function ChannelMemberToJSONTyped(value?: ChannelMember | null, ignoreDiscriminator?: boolean): any;
