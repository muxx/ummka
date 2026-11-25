export function instanceOfChannelNotifyProps(value) {
    return true;
}
export function ChannelNotifyPropsFromJSON(json) {
    return ChannelNotifyPropsFromJSONTyped(json, false);
}
export function ChannelNotifyPropsFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'email': json['email'] == null ? undefined : json['email'],
        'push': json['push'] == null ? undefined : json['push'],
        'desktop': json['desktop'] == null ? undefined : json['desktop'],
        'markUnread': json['mark_unread'] == null ? undefined : json['mark_unread'],
        'desktopThreads': json['desktop_threads'] == null ? undefined : json['desktop_threads'],
        'pushThreads': json['push_threads'] == null ? undefined : json['push_threads'],
        'ignoreChannelMentions': json['ignore_channel_mentions'] == null ? undefined : json['ignore_channel_mentions'],
        'channelAutoFollowThreads': json['channel_auto_follow_threads'] == null ? undefined : json['channel_auto_follow_threads'],
        'desktopSound': json['desktop_sound'] == null ? undefined : json['desktop_sound'],
        'desktopNotificationSound': json['desktop_notification_sound'] == null ? undefined : json['desktop_notification_sound'],
    };
}
export function ChannelNotifyPropsToJSON(json) {
    return ChannelNotifyPropsToJSONTyped(json, false);
}
export function ChannelNotifyPropsToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'email': value['email'],
        'push': value['push'],
        'desktop': value['desktop'],
        'mark_unread': value['markUnread'],
        'desktop_threads': value['desktopThreads'],
        'push_threads': value['pushThreads'],
        'ignore_channel_mentions': value['ignoreChannelMentions'],
        'channel_auto_follow_threads': value['channelAutoFollowThreads'],
        'desktop_sound': value['desktopSound'],
        'desktop_notification_sound': value['desktopNotificationSound'],
    };
}
