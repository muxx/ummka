export function instanceOfCanUserDirectMessage200Response(value) {
    if ((!('canDm' in value) && !('can_dm' in value)) || (value['canDm'] === undefined && value['can_dm'] === undefined))
        return false;
    return true;
}
export function CanUserDirectMessage200ResponseFromJSON(json) {
    return CanUserDirectMessage200ResponseFromJSONTyped(json, false);
}
export function CanUserDirectMessage200ResponseFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'canDm': json['can_dm'],
    };
}
export function CanUserDirectMessage200ResponseToJSON(json) {
    return CanUserDirectMessage200ResponseToJSONTyped(json, false);
}
export function CanUserDirectMessage200ResponseToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'can_dm': value['canDm'],
    };
}
