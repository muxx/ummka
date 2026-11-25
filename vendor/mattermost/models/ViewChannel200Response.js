export function instanceOfViewChannel200Response(value) {
    return true;
}
export function ViewChannel200ResponseFromJSON(json) {
    return ViewChannel200ResponseFromJSONTyped(json, false);
}
export function ViewChannel200ResponseFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'status': json['status'] == null ? undefined : json['status'],
        'lastViewedAtTimes': json['last_viewed_at_times'] == null ? undefined : json['last_viewed_at_times'],
    };
}
export function ViewChannel200ResponseToJSON(json) {
    return ViewChannel200ResponseToJSONTyped(json, false);
}
export function ViewChannel200ResponseToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'status': value['status'],
        'last_viewed_at_times': value['lastViewedAtTimes'],
    };
}
