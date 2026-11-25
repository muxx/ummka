export function instanceOfAddChannelMemberRequest(value) {
    if ((!('userId' in value) && !('user_id' in value)) || (value['userId'] === undefined && value['user_id'] === undefined))
        return false;
    return true;
}
export function AddChannelMemberRequestFromJSON(json) {
    return AddChannelMemberRequestFromJSONTyped(json, false);
}
export function AddChannelMemberRequestFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'userId': json['user_id'],
        'postRootId': json['post_root_id'] == null ? undefined : json['post_root_id'],
    };
}
export function AddChannelMemberRequestToJSON(json) {
    return AddChannelMemberRequestToJSONTyped(json, false);
}
export function AddChannelMemberRequestToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'user_id': value['userId'],
        'post_root_id': value['postRootId'],
    };
}
