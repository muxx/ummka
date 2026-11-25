export function instanceOfChannelUnreadAt(value) {
    return true;
}
export function ChannelUnreadAtFromJSON(json) {
    return ChannelUnreadAtFromJSONTyped(json, false);
}
export function ChannelUnreadAtFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'teamId': json['team_id'] == null ? undefined : json['team_id'],
        'channelId': json['channel_id'] == null ? undefined : json['channel_id'],
        'msgCount': json['msg_count'] == null ? undefined : json['msg_count'],
        'mentionCount': json['mention_count'] == null ? undefined : json['mention_count'],
        'lastViewedAt': json['last_viewed_at'] == null ? undefined : json['last_viewed_at'],
        'userId': json['user_id'] == null ? undefined : json['user_id'],
        'msgCountRoot': json['msg_count_root'] == null ? undefined : json['msg_count_root'],
        'mentionCountRoot': json['mention_count_root'] == null ? undefined : json['mention_count_root'],
        'urgentMentionCount': json['urgent_mention_count'] == null ? undefined : json['urgent_mention_count'],
    };
}
export function ChannelUnreadAtToJSON(json) {
    return ChannelUnreadAtToJSONTyped(json, false);
}
export function ChannelUnreadAtToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'team_id': value['teamId'],
        'channel_id': value['channelId'],
        'msg_count': value['msgCount'],
        'mention_count': value['mentionCount'],
        'last_viewed_at': value['lastViewedAt'],
        'user_id': value['userId'],
        'msg_count_root': value['msgCountRoot'],
        'mention_count_root': value['mentionCountRoot'],
        'urgent_mention_count': value['urgentMentionCount'],
    };
}
