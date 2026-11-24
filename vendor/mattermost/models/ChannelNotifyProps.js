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
    };
}
