export function instanceOfReaction(value) {
    return true;
}
export function ReactionFromJSON(json) {
    return ReactionFromJSONTyped(json, false);
}
export function ReactionFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'userId': json['user_id'] == null ? undefined : json['user_id'],
        'postId': json['post_id'] == null ? undefined : json['post_id'],
        'emojiName': json['emoji_name'] == null ? undefined : json['emoji_name'],
        'createAt': json['create_at'] == null ? undefined : json['create_at'],
    };
}
export function ReactionToJSON(json) {
    return ReactionToJSONTyped(json, false);
}
export function ReactionToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'user_id': value['userId'],
        'post_id': value['postId'],
        'emoji_name': value['emojiName'],
        'create_at': value['createAt'],
    };
}
