export function instanceOfMarkChannelsReadForUser200Response(value) {
    return true;
}
export function MarkChannelsReadForUser200ResponseFromJSON(json) {
    return MarkChannelsReadForUser200ResponseFromJSONTyped(json, false);
}
export function MarkChannelsReadForUser200ResponseFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'status': json['status'] == null ? undefined : json['status'],
        'lastViewedAtTimes': json['last_viewed_at_times'] == null ? undefined : json['last_viewed_at_times'],
    };
}
export function MarkChannelsReadForUser200ResponseToJSON(json) {
    return MarkChannelsReadForUser200ResponseToJSONTyped(json, false);
}
export function MarkChannelsReadForUser200ResponseToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'status': value['status'],
        'last_viewed_at_times': value['lastViewedAtTimes'],
    };
}
