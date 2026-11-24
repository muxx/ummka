export function instanceOfAppError(value) {
    return true;
}
export function AppErrorFromJSON(json) {
    return AppErrorFromJSONTyped(json, false);
}
export function AppErrorFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'statusCode': json['status_code'] == null ? undefined : json['status_code'],
        'id': json['id'] == null ? undefined : json['id'],
        'message': json['message'] == null ? undefined : json['message'],
        'requestId': json['request_id'] == null ? undefined : json['request_id'],
    };
}
export function AppErrorToJSON(json) {
    return AppErrorToJSONTyped(json, false);
}
export function AppErrorToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'status_code': value['statusCode'],
        'id': value['id'],
        'message': value['message'],
        'request_id': value['requestId'],
    };
}
