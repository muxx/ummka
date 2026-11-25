export function instanceOfSetPostUnreadRequest(value) {
    if ((!('collapsedThreadsSupported' in value) && !('collapsed_threads_supported' in value)) || (value['collapsedThreadsSupported'] === undefined && value['collapsed_threads_supported'] === undefined))
        return false;
    return true;
}
export function SetPostUnreadRequestFromJSON(json) {
    return SetPostUnreadRequestFromJSONTyped(json, false);
}
export function SetPostUnreadRequestFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'collapsedThreadsSupported': json['collapsed_threads_supported'],
    };
}
export function SetPostUnreadRequestToJSON(json) {
    return SetPostUnreadRequestToJSONTyped(json, false);
}
export function SetPostUnreadRequestToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'collapsed_threads_supported': value['collapsedThreadsSupported'],
    };
}
