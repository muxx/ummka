export function instanceOfPatchPostRequest(value) {
    return true;
}
export function PatchPostRequestFromJSON(json) {
    return PatchPostRequestFromJSONTyped(json, false);
}
export function PatchPostRequestFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'isPinned': json['is_pinned'] == null ? undefined : json['is_pinned'],
        'message': json['message'] == null ? undefined : json['message'],
        'fileIds': json['file_ids'] == null ? undefined : json['file_ids'],
        'hasReactions': json['has_reactions'] == null ? undefined : json['has_reactions'],
        'props': json['props'] == null ? undefined : json['props'],
    };
}
export function PatchPostRequestToJSON(json) {
    return PatchPostRequestToJSONTyped(json, false);
}
export function PatchPostRequestToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'is_pinned': value['isPinned'],
        'message': value['message'],
        'file_ids': value['fileIds'],
        'has_reactions': value['hasReactions'],
        'props': value['props'],
    };
}
