export function instanceOfChannelStats(value) {
    if ((!('channelId' in value) && !('channel_id' in value)) || (value['channelId'] === undefined && value['channel_id'] === undefined))
        return false;
    if ((!('memberCount' in value) && !('member_count' in value)) || (value['memberCount'] === undefined && value['member_count'] === undefined))
        return false;
    if ((!('guestCount' in value) && !('guest_count' in value)) || (value['guestCount'] === undefined && value['guest_count'] === undefined))
        return false;
    if ((!('pinnedpostCount' in value) && !('pinnedpost_count' in value)) || (value['pinnedpostCount'] === undefined && value['pinnedpost_count'] === undefined))
        return false;
    if ((!('filesCount' in value) && !('files_count' in value)) || (value['filesCount'] === undefined && value['files_count'] === undefined))
        return false;
    return true;
}
export function ChannelStatsFromJSON(json) {
    return ChannelStatsFromJSONTyped(json, false);
}
export function ChannelStatsFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'channelId': json['channel_id'],
        'memberCount': json['member_count'],
        'guestCount': json['guest_count'],
        'pinnedpostCount': json['pinnedpost_count'],
        'filesCount': json['files_count'],
    };
}
export function ChannelStatsToJSON(json) {
    return ChannelStatsToJSONTyped(json, false);
}
export function ChannelStatsToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'channel_id': value['channelId'],
        'member_count': value['memberCount'],
        'guest_count': value['guestCount'],
        'pinnedpost_count': value['pinnedpostCount'],
        'files_count': value['filesCount'],
    };
}
