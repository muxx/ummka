export function instanceOfUserNotifyProps(value) {
    return true;
}
export function UserNotifyPropsFromJSON(json) {
    return UserNotifyPropsFromJSONTyped(json, false);
}
export function UserNotifyPropsFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'email': json['email'] == null ? undefined : json['email'],
        'push': json['push'] == null ? undefined : json['push'],
        'desktop': json['desktop'] == null ? undefined : json['desktop'],
        'desktopSound': json['desktop_sound'] == null ? undefined : json['desktop_sound'],
        'mentionKeys': json['mention_keys'] == null ? undefined : json['mention_keys'],
        'channel': json['channel'] == null ? undefined : json['channel'],
        'firstName': json['first_name'] == null ? undefined : json['first_name'],
    };
}
export function UserNotifyPropsToJSON(json) {
    return UserNotifyPropsToJSONTyped(json, false);
}
export function UserNotifyPropsToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'email': value['email'],
        'push': value['push'],
        'desktop': value['desktop'],
        'desktop_sound': value['desktopSound'],
        'mention_keys': value['mentionKeys'],
        'channel': value['channel'],
        'first_name': value['firstName'],
    };
}
