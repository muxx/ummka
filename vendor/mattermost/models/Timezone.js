export function instanceOfTimezone(value) {
    return true;
}
export function TimezoneFromJSON(json) {
    return TimezoneFromJSONTyped(json, false);
}
export function TimezoneFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'useAutomaticTimezone': json['useAutomaticTimezone'] == null ? undefined : json['useAutomaticTimezone'],
        'manualTimezone': json['manualTimezone'] == null ? undefined : json['manualTimezone'],
        'automaticTimezone': json['automaticTimezone'] == null ? undefined : json['automaticTimezone'],
    };
}
export function TimezoneToJSON(json) {
    return TimezoneToJSONTyped(json, false);
}
export function TimezoneToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'useAutomaticTimezone': value['useAutomaticTimezone'],
        'manualTimezone': value['manualTimezone'],
        'automaticTimezone': value['automaticTimezone'],
    };
}
