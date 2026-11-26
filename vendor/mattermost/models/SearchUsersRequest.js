export function instanceOfSearchUsersRequest(value) {
    if (!('term' in value) || value['term'] === undefined)
        return false;
    return true;
}
export function SearchUsersRequestFromJSON(json) {
    return SearchUsersRequestFromJSONTyped(json, false);
}
export function SearchUsersRequestFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'term': json['term'],
        'teamId': json['team_id'] == null ? undefined : json['team_id'],
        'notInTeamId': json['not_in_team_id'] == null ? undefined : json['not_in_team_id'],
        'inChannelId': json['in_channel_id'] == null ? undefined : json['in_channel_id'],
        'notInChannelId': json['not_in_channel_id'] == null ? undefined : json['not_in_channel_id'],
        'inGroupId': json['in_group_id'] == null ? undefined : json['in_group_id'],
        'groupConstrained': json['group_constrained'] == null ? undefined : json['group_constrained'],
        'allowInactive': json['allow_inactive'] == null ? undefined : json['allow_inactive'],
        'withoutTeam': json['without_team'] == null ? undefined : json['without_team'],
        'limit': json['limit'] == null ? undefined : json['limit'],
    };
}
export function SearchUsersRequestToJSON(json) {
    return SearchUsersRequestToJSONTyped(json, false);
}
export function SearchUsersRequestToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'term': value['term'],
        'team_id': value['teamId'],
        'not_in_team_id': value['notInTeamId'],
        'in_channel_id': value['inChannelId'],
        'not_in_channel_id': value['notInChannelId'],
        'in_group_id': value['inGroupId'],
        'group_constrained': value['groupConstrained'],
        'allow_inactive': value['allowInactive'],
        'without_team': value['withoutTeam'],
        'limit': value['limit'],
    };
}
