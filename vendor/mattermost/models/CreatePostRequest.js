import { CreatePostRequestMetadataFromJSON, CreatePostRequestMetadataToJSON, } from './CreatePostRequestMetadata.js';
export function instanceOfCreatePostRequest(value) {
    if ((!('channelId' in value) && !('channel_id' in value)) || (value['channelId'] === undefined && value['channel_id'] === undefined))
        return false;
    if (!('message' in value) || value['message'] === undefined)
        return false;
    return true;
}
export function CreatePostRequestFromJSON(json) {
    return CreatePostRequestFromJSONTyped(json, false);
}
export function CreatePostRequestFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'channelId': json['channel_id'],
        'message': json['message'],
        'rootId': json['root_id'] == null ? undefined : json['root_id'],
        'fileIds': json['file_ids'] == null ? undefined : json['file_ids'],
        'props': json['props'] == null ? undefined : json['props'],
        'metadata': json['metadata'] == null ? undefined : CreatePostRequestMetadataFromJSON(json['metadata']),
        'pendingPostId': json['pending_post_id'] == null ? undefined : json['pending_post_id'],
    };
}
export function CreatePostRequestToJSON(json) {
    return CreatePostRequestToJSONTyped(json, false);
}
export function CreatePostRequestToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'channel_id': value['channelId'],
        'message': value['message'],
        'root_id': value['rootId'],
        'file_ids': value['fileIds'],
        'props': value['props'],
        'metadata': CreatePostRequestMetadataToJSON(value['metadata']),
        'pending_post_id': value['pendingPostId'],
    };
}
