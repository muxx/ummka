export function instanceOfExecuteCommandRequest(value) {
    if ((!('channelId' in value) && !('channel_id' in value)) || (value['channelId'] === undefined && value['channel_id'] === undefined))
        return false;
    if (!('command' in value) || value['command'] === undefined)
        return false;
    return true;
}
export function ExecuteCommandRequestFromJSON(json) {
    return ExecuteCommandRequestFromJSONTyped(json, false);
}
export function ExecuteCommandRequestFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'channelId': json['channel_id'],
        'command': json['command'],
        'teamId': json['team_id'] == null ? undefined : json['team_id'],
        'rootId': json['root_id'] == null ? undefined : json['root_id'],
    };
}
export function ExecuteCommandRequestToJSON(json) {
    return ExecuteCommandRequestToJSONTyped(json, false);
}
export function ExecuteCommandRequestToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'channel_id': value['channelId'],
        'command': value['command'],
        'team_id': value['teamId'],
        'root_id': value['rootId'],
    };
}
