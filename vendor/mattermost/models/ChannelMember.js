import { ChannelNotifyPropsFromJSON, ChannelNotifyPropsToJSON, } from './ChannelNotifyProps.js';
export function instanceOfChannelMember(value) {
    return true;
}
export function ChannelMemberFromJSON(json) {
    return ChannelMemberFromJSONTyped(json, false);
}
export function ChannelMemberFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'channelId': json['channel_id'] == null ? undefined : json['channel_id'],
        'userId': json['user_id'] == null ? undefined : json['user_id'],
        'roles': json['roles'] == null ? undefined : json['roles'],
        'lastViewedAt': json['last_viewed_at'] == null ? undefined : json['last_viewed_at'],
        'msgCount': json['msg_count'] == null ? undefined : json['msg_count'],
        'mentionCount': json['mention_count'] == null ? undefined : json['mention_count'],
        'notifyProps': json['notify_props'] == null ? undefined : ChannelNotifyPropsFromJSON(json['notify_props']),
        'lastUpdateAt': json['last_update_at'] == null ? undefined : json['last_update_at'],
    };
}
export function ChannelMemberToJSON(json) {
    return ChannelMemberToJSONTyped(json, false);
}
export function ChannelMemberToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'channel_id': value['channelId'],
        'user_id': value['userId'],
        'roles': value['roles'],
        'last_viewed_at': value['lastViewedAt'],
        'msg_count': value['msgCount'],
        'mention_count': value['mentionCount'],
        'notify_props': ChannelNotifyPropsToJSON(value['notifyProps']),
        'last_update_at': value['lastUpdateAt'],
    };
}
