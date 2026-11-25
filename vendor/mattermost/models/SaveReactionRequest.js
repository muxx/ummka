export function instanceOfSaveReactionRequest(value) {
    if ((!('userId' in value) && !('user_id' in value)) || (value['userId'] === undefined && value['user_id'] === undefined))
        return false;
    if ((!('postId' in value) && !('post_id' in value)) || (value['postId'] === undefined && value['post_id'] === undefined))
        return false;
    if ((!('emojiName' in value) && !('emoji_name' in value)) || (value['emojiName'] === undefined && value['emoji_name'] === undefined))
        return false;
    return true;
}
export function SaveReactionRequestFromJSON(json) {
    return SaveReactionRequestFromJSONTyped(json, false);
}
export function SaveReactionRequestFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'userId': json['user_id'],
        'postId': json['post_id'],
        'emojiName': json['emoji_name'],
    };
}
export function SaveReactionRequestToJSON(json) {
    return SaveReactionRequestToJSONTyped(json, false);
}
export function SaveReactionRequestToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'user_id': value['userId'],
        'post_id': value['postId'],
        'emoji_name': value['emojiName'],
    };
}
