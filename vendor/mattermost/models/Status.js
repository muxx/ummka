export function instanceOfStatus(value) {
    return true;
}
export function StatusFromJSON(json) {
    return StatusFromJSONTyped(json, false);
}
export function StatusFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'userId': json['user_id'] == null ? undefined : json['user_id'],
        'status': json['status'] == null ? undefined : json['status'],
        'manual': json['manual'] == null ? undefined : json['manual'],
        'lastActivityAt': json['last_activity_at'] == null ? undefined : json['last_activity_at'],
        'dndEndTime': json['dnd_end_time'] == null ? undefined : json['dnd_end_time'],
    };
}
export function StatusToJSON(json) {
    return StatusToJSONTyped(json, false);
}
export function StatusToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'user_id': value['userId'],
        'status': value['status'],
        'manual': value['manual'],
        'last_activity_at': value['lastActivityAt'],
        'dnd_end_time': value['dndEndTime'],
    };
}
