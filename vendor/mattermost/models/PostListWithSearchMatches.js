import { mapValues } from '../runtime.js';
import { PostFromJSON, PostToJSON, } from './Post.js';
export function instanceOfPostListWithSearchMatches(value) {
    if (!('order' in value) || value['order'] === undefined)
        return false;
    if (!('posts' in value) || value['posts'] === undefined)
        return false;
    if ((!('nextPostId' in value) && !('next_post_id' in value)) || (value['nextPostId'] === undefined && value['next_post_id'] === undefined))
        return false;
    if ((!('prevPostId' in value) && !('prev_post_id' in value)) || (value['prevPostId'] === undefined && value['prev_post_id'] === undefined))
        return false;
    if ((!('firstInaccessiblePostTime' in value) && !('first_inaccessible_post_time' in value)) || (value['firstInaccessiblePostTime'] === undefined && value['first_inaccessible_post_time'] === undefined))
        return false;
    if (!('matches' in value) || value['matches'] === undefined)
        return false;
    return true;
}
export function PostListWithSearchMatchesFromJSON(json) {
    return PostListWithSearchMatchesFromJSONTyped(json, false);
}
export function PostListWithSearchMatchesFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'order': json['order'],
        'posts': (mapValues(json['posts'], PostFromJSON)),
        'nextPostId': json['next_post_id'],
        'prevPostId': json['prev_post_id'],
        'hasNext': json['has_next'] == null ? undefined : json['has_next'],
        'firstInaccessiblePostTime': json['first_inaccessible_post_time'],
        'matches': json['matches'],
    };
}
export function PostListWithSearchMatchesToJSON(json) {
    return PostListWithSearchMatchesToJSONTyped(json, false);
}
export function PostListWithSearchMatchesToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'order': value['order'],
        'posts': (mapValues(value['posts'], PostToJSON)),
        'next_post_id': value['nextPostId'],
        'prev_post_id': value['prevPostId'],
        'has_next': value['hasNext'],
        'first_inaccessible_post_time': value['firstInaccessiblePostTime'],
        'matches': value['matches'],
    };
}
