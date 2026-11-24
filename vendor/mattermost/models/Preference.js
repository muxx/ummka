export function instanceOfPreference(value) {
    return true;
}
export function PreferenceFromJSON(json) {
    return PreferenceFromJSONTyped(json, false);
}
export function PreferenceFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'userId': json['user_id'] == null ? undefined : json['user_id'],
        'category': json['category'] == null ? undefined : json['category'],
        'name': json['name'] == null ? undefined : json['name'],
        'value': json['value'] == null ? undefined : json['value'],
    };
}
export function PreferenceToJSON(json) {
    return PreferenceToJSONTyped(json, false);
}
export function PreferenceToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'user_id': value['userId'],
        'category': value['category'],
        'name': value['name'],
        'value': value['value'],
    };
}
