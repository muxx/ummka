export function instanceOfPostAcknowledgement(value) {
    return true;
}
export function PostAcknowledgementFromJSON(json) {
    return PostAcknowledgementFromJSONTyped(json, false);
}
export function PostAcknowledgementFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'userId': json['user_id'] == null ? undefined : json['user_id'],
        'postId': json['post_id'] == null ? undefined : json['post_id'],
        'acknowledgedAt': json['acknowledged_at'] == null ? undefined : json['acknowledged_at'],
    };
}
export function PostAcknowledgementToJSON(json) {
    return PostAcknowledgementToJSONTyped(json, false);
}
export function PostAcknowledgementToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'user_id': value['userId'],
        'post_id': value['postId'],
        'acknowledged_at': value['acknowledgedAt'],
    };
}
