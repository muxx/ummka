import { UserFromJSON, UserToJSON, } from './User.js';
import { PostMetadataFromJSON, PostMetadataToJSON, } from './PostMetadata.js';
export function instanceOfPost(value) {
    return true;
}
export function PostFromJSON(json) {
    return PostFromJSONTyped(json, false);
}
export function PostFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'id': json['id'] == null ? undefined : json['id'],
        'createAt': json['create_at'] == null ? undefined : json['create_at'],
        'updateAt': json['update_at'] == null ? undefined : json['update_at'],
        'deleteAt': json['delete_at'] == null ? undefined : json['delete_at'],
        'editAt': json['edit_at'] == null ? undefined : json['edit_at'],
        'userId': json['user_id'] == null ? undefined : json['user_id'],
        'channelId': json['channel_id'] == null ? undefined : json['channel_id'],
        'rootId': json['root_id'] == null ? undefined : json['root_id'],
        'originalId': json['original_id'] == null ? undefined : json['original_id'],
        'message': json['message'] == null ? undefined : json['message'],
        'type': json['type'] == null ? undefined : json['type'],
        'props': json['props'] == null ? undefined : json['props'],
        'hashtag': json['hashtag'] == null ? undefined : json['hashtag'],
        'fileIds': json['file_ids'] == null ? undefined : json['file_ids'],
        'pendingPostId': json['pending_post_id'] == null ? undefined : json['pending_post_id'],
        'metadata': json['metadata'] == null ? undefined : PostMetadataFromJSON(json['metadata']),
        'replyCount': json['reply_count'] == null ? undefined : json['reply_count'],
        'lastReplyAt': json['last_reply_at'] == null ? undefined : json['last_reply_at'],
        'participants': json['participants'] === undefined ? undefined : json['participants'] === null ? null : (json['participants'].map(UserFromJSON)),
        'isFollowing': json['is_following'] == null ? undefined : json['is_following'],
    };
}
export function PostToJSON(json) {
    return PostToJSONTyped(json, false);
}
export function PostToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'id': value['id'],
        'create_at': value['createAt'],
        'update_at': value['updateAt'],
        'delete_at': value['deleteAt'],
        'edit_at': value['editAt'],
        'user_id': value['userId'],
        'channel_id': value['channelId'],
        'root_id': value['rootId'],
        'original_id': value['originalId'],
        'message': value['message'],
        'type': value['type'],
        'props': value['props'],
        'hashtag': value['hashtag'],
        'file_ids': value['fileIds'],
        'pending_post_id': value['pendingPostId'],
        'metadata': PostMetadataToJSON(value['metadata']),
        'reply_count': value['replyCount'],
        'last_reply_at': value['lastReplyAt'],
        'participants': value['participants'] == null ? undefined : (value['participants'].map(UserToJSON)),
        'is_following': value['isFollowing'],
    };
}
