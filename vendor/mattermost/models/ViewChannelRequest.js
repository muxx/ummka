export function instanceOfViewChannelRequest(value) {
    if ((!('channelId' in value) && !('channel_id' in value)) || (value['channelId'] === undefined && value['channel_id'] === undefined))
        return false;
    return true;
}
export function ViewChannelRequestFromJSON(json) {
    return ViewChannelRequestFromJSONTyped(json, false);
}
export function ViewChannelRequestFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'channelId': json['channel_id'],
        'prevChannelId': json['prev_channel_id'] == null ? undefined : json['prev_channel_id'],
        'collapsedThreadsSupported': json['collapsed_threads_supported'] == null ? undefined : json['collapsed_threads_supported'],
    };
}
export function ViewChannelRequestToJSON(json) {
    return ViewChannelRequestToJSONTyped(json, false);
}
export function ViewChannelRequestToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'channel_id': value['channelId'],
        'prev_channel_id': value['prevChannelId'],
        'collapsed_threads_supported': value['collapsedThreadsSupported'],
    };
}
