export function instanceOfCreatePostRequestMetadataPriority(value) {
    return true;
}
export function CreatePostRequestMetadataPriorityFromJSON(json) {
    return CreatePostRequestMetadataPriorityFromJSONTyped(json, false);
}
export function CreatePostRequestMetadataPriorityFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'priority': json['priority'] == null ? undefined : json['priority'],
        'requestedAck': json['requested_ack'] == null ? undefined : json['requested_ack'],
    };
}
export function CreatePostRequestMetadataPriorityToJSON(json) {
    return CreatePostRequestMetadataPriorityToJSONTyped(json, false);
}
export function CreatePostRequestMetadataPriorityToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'priority': value['priority'],
        'requested_ack': value['requestedAck'],
    };
}
