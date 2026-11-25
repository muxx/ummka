export interface ChannelNotifyProps {
    email?: string;
    push?: string;
    desktop?: string;
    markUnread?: string;
    desktopThreads?: string;
    pushThreads?: string;
    ignoreChannelMentions?: string;
    channelAutoFollowThreads?: string;
    desktopSound?: string;
    desktopNotificationSound?: string;
}
export declare function instanceOfChannelNotifyProps(value: object): value is ChannelNotifyProps;
export declare function ChannelNotifyPropsFromJSON(json: any): ChannelNotifyProps;
export declare function ChannelNotifyPropsFromJSONTyped(json: any, ignoreDiscriminator: boolean): ChannelNotifyProps;
export declare function ChannelNotifyPropsToJSON(json: any): ChannelNotifyProps;
export declare function ChannelNotifyPropsToJSONTyped(value?: ChannelNotifyProps | null, ignoreDiscriminator?: boolean): any;
