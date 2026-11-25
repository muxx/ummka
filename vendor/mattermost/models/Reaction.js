export function instanceOfReaction(value) {
    if ((!('userId' in value) && !('user_id' in value)) || (value['userId'] === undefined && value['user_id'] === undefined))
        return false;
    if ((!('postId' in value) && !('post_id' in value)) || (value['postId'] === undefined && value['post_id'] === undefined))
        return false;
    if ((!('emojiName' in value) && !('emoji_name' in value)) || (value['emojiName'] === undefined && value['emoji_name'] === undefined))
        return false;
    if ((!('createAt' in value) && !('create_at' in value)) || (value['createAt'] === undefined && value['create_at'] === undefined))
        return false;
    if ((!('channelId' in value) && !('channel_id' in value)) || (value['channelId'] === undefined && value['channel_id'] === undefined))
        return false;
    if ((!('updateAt' in value) && !('update_at' in value)) || (value['updateAt'] === undefined && value['update_at'] === undefined))
        return false;
    if ((!('deleteAt' in value) && !('delete_at' in value)) || (value['deleteAt'] === undefined && value['delete_at'] === undefined))
        return false;
    if ((!('remoteId' in value) && !('remote_id' in value)) || (value['remoteId'] === undefined && value['remote_id'] === undefined))
        return false;
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
        'userId': json['user_id'],
        'postId': json['post_id'],
        'emojiName': json['emoji_name'],
        'createAt': json['create_at'],
        'channelId': json['channel_id'],
        'updateAt': json['update_at'],
        'deleteAt': json['delete_at'],
        'remoteId': json['remote_id'],
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
        'channel_id': value['channelId'],
        'update_at': value['updateAt'],
        'delete_at': value['deleteAt'],
        'remote_id': value['remoteId'],
    };
}
