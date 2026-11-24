import { mapValues } from '../runtime.js';
import { PostFromJSON, PostToJSON, } from './Post.js';
export function instanceOfPostList(value) {
    return true;
}
export function PostListFromJSON(json) {
    return PostListFromJSONTyped(json, false);
}
export function PostListFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'order': json['order'] == null ? undefined : json['order'],
        'posts': json['posts'] == null ? undefined : (mapValues(json['posts'], PostFromJSON)),
        'nextPostId': json['next_post_id'] == null ? undefined : json['next_post_id'],
        'prevPostId': json['prev_post_id'] == null ? undefined : json['prev_post_id'],
        'hasNext': json['has_next'] == null ? undefined : json['has_next'],
        'firstInaccessiblePostTime': json['first_inaccessible_post_time'] == null ? undefined : json['first_inaccessible_post_time'],
    };
}
export function PostListToJSON(json) {
    return PostListToJSONTyped(json, false);
}
export function PostListToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'order': value['order'],
        'posts': value['posts'] == null ? undefined : (mapValues(value['posts'], PostToJSON)),
        'next_post_id': value['nextPostId'],
        'prev_post_id': value['prevPostId'],
        'has_next': value['hasNext'],
        'first_inaccessible_post_time': value['firstInaccessiblePostTime'],
    };
}
