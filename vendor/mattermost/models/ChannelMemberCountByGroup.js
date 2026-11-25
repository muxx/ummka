export function instanceOfChannelMemberCountByGroup(value) {
    if ((!('groupId' in value) && !('group_id' in value)) || (value['groupId'] === undefined && value['group_id'] === undefined))
        return false;
    if ((!('channelMemberCount' in value) && !('channel_member_count' in value)) || (value['channelMemberCount'] === undefined && value['channel_member_count'] === undefined))
        return false;
    if ((!('channelMemberTimezonesCount' in value) && !('channel_member_timezones_count' in value)) || (value['channelMemberTimezonesCount'] === undefined && value['channel_member_timezones_count'] === undefined))
        return false;
    return true;
}
export function ChannelMemberCountByGroupFromJSON(json) {
    return ChannelMemberCountByGroupFromJSONTyped(json, false);
}
export function ChannelMemberCountByGroupFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'groupId': json['group_id'],
        'channelMemberCount': json['channel_member_count'],
        'channelMemberTimezonesCount': json['channel_member_timezones_count'],
    };
}
export function ChannelMemberCountByGroupToJSON(json) {
    return ChannelMemberCountByGroupToJSONTyped(json, false);
}
export function ChannelMemberCountByGroupToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'group_id': value['groupId'],
        'channel_member_count': value['channelMemberCount'],
        'channel_member_timezones_count': value['channelMemberTimezonesCount'],
    };
}
