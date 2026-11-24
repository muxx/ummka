export function instanceOfPostInfo(value) {
    return true;
}
export function PostInfoFromJSON(json) {
    return PostInfoFromJSONTyped(json, false);
}
export function PostInfoFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'channelId': json['channel_id'] == null ? undefined : json['channel_id'],
        'channelType': json['channel_type'] == null ? undefined : json['channel_type'],
        'channelDisplayName': json['channel_display_name'] == null ? undefined : json['channel_display_name'],
        'hasJoinedChannel': json['has_joined_channel'] == null ? undefined : json['has_joined_channel'],
        'teamId': json['team_id'] == null ? undefined : json['team_id'],
        'teamType': json['team_type'] == null ? undefined : json['team_type'],
        'teamDisplayName': json['team_display_name'] == null ? undefined : json['team_display_name'],
        'hasJoinedTeam': json['has_joined_team'] == null ? undefined : json['has_joined_team'],
    };
}
export function PostInfoToJSON(json) {
    return PostInfoToJSONTyped(json, false);
}
export function PostInfoToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'channel_id': value['channelId'],
        'channel_type': value['channelType'],
        'channel_display_name': value['channelDisplayName'],
        'has_joined_channel': value['hasJoinedChannel'],
        'team_id': value['teamId'],
        'team_type': value['teamType'],
        'team_display_name': value['teamDisplayName'],
        'has_joined_team': value['hasJoinedTeam'],
    };
}
