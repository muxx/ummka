export function instanceOfPostMetadataPriority(value) {
    return true;
}
export function PostMetadataPriorityFromJSON(json) {
    return PostMetadataPriorityFromJSONTyped(json, false);
}
export function PostMetadataPriorityFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'priority': json['priority'] == null ? undefined : json['priority'],
        'requestedAck': json['requested_ack'] == null ? undefined : json['requested_ack'],
    };
}
export function PostMetadataPriorityToJSON(json) {
    return PostMetadataPriorityToJSONTyped(json, false);
}
export function PostMetadataPriorityToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'priority': value['priority'],
        'requested_ack': value['requestedAck'],
    };
}
