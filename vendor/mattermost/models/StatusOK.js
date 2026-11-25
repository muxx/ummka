export function instanceOfStatusOK(value) {
    return true;
}
export function StatusOKFromJSON(json) {
    return StatusOKFromJSONTyped(json, false);
}
export function StatusOKFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'status': json['status'] == null ? undefined : json['status'],
    };
}
export function StatusOKToJSON(json) {
    return StatusOKToJSONTyped(json, false);
}
export function StatusOKToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'status': value['status'],
    };
}
