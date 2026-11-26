import { UserThreadFromJSON, UserThreadToJSON, } from './UserThread.js';
export function instanceOfUserThreads(value) {
    return true;
}
export function UserThreadsFromJSON(json) {
    return UserThreadsFromJSONTyped(json, false);
}
export function UserThreadsFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'total': json['total'] == null ? undefined : json['total'],
        'threads': json['threads'] === undefined ? undefined : json['threads'] === null ? null : (json['threads'].map(UserThreadFromJSON)),
        'totalUnreadThreads': json['total_unread_threads'] == null ? undefined : json['total_unread_threads'],
        'totalUnreadMentions': json['total_unread_mentions'] == null ? undefined : json['total_unread_mentions'],
        'totalUnreadUrgentMentions': json['total_unread_urgent_mentions'] == null ? undefined : json['total_unread_urgent_mentions'],
    };
}
export function UserThreadsToJSON(json) {
    return UserThreadsToJSONTyped(json, false);
}
export function UserThreadsToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'total': value['total'],
        'threads': value['threads'] == null ? undefined : (value['threads'].map(UserThreadToJSON)),
        'total_unread_threads': value['totalUnreadThreads'],
        'total_unread_mentions': value['totalUnreadMentions'],
        'total_unread_urgent_mentions': value['totalUnreadUrgentMentions'],
    };
}
