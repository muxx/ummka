import { UserFromJSON, UserToJSON, } from './User.js';
import { PostFromJSON, PostToJSON, } from './Post.js';
export function instanceOfUserThread(value) {
    return true;
}
export function UserThreadFromJSON(json) {
    return UserThreadFromJSONTyped(json, false);
}
export function UserThreadFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'id': json['id'] == null ? undefined : json['id'],
        'replyCount': json['reply_count'] == null ? undefined : json['reply_count'],
        'lastReplyAt': json['last_reply_at'] == null ? undefined : json['last_reply_at'],
        'lastViewedAt': json['last_viewed_at'] == null ? undefined : json['last_viewed_at'],
        'participants': json['participants'] == null ? undefined : (json['participants'].map(UserFromJSON)),
        'post': json['post'] == null ? undefined : PostFromJSON(json['post']),
        'unreadReplies': json['unread_replies'] == null ? undefined : json['unread_replies'],
        'unreadMentions': json['unread_mentions'] == null ? undefined : json['unread_mentions'],
        'isUrgent': json['is_urgent'] == null ? undefined : json['is_urgent'],
        'deleteAt': json['delete_at'] == null ? undefined : json['delete_at'],
    };
}
export function UserThreadToJSON(json) {
    return UserThreadToJSONTyped(json, false);
}
export function UserThreadToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'id': value['id'],
        'reply_count': value['replyCount'],
        'last_reply_at': value['lastReplyAt'],
        'last_viewed_at': value['lastViewedAt'],
        'participants': value['participants'] == null ? undefined : (value['participants'].map(UserToJSON)),
        'post': PostToJSON(value['post']),
        'unread_replies': value['unreadReplies'],
        'unread_mentions': value['unreadMentions'],
        'is_urgent': value['isUrgent'],
        'delete_at': value['deleteAt'],
    };
}
