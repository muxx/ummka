import { CreatePostRequestMetadataPriorityFromJSON, CreatePostRequestMetadataPriorityToJSON, } from './CreatePostRequestMetadataPriority.js';
export function instanceOfCreatePostRequestMetadata(value) {
    return true;
}
export function CreatePostRequestMetadataFromJSON(json) {
    return CreatePostRequestMetadataFromJSONTyped(json, false);
}
export function CreatePostRequestMetadataFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'priority': json['priority'] == null ? undefined : CreatePostRequestMetadataPriorityFromJSON(json['priority']),
    };
}
export function CreatePostRequestMetadataToJSON(json) {
    return CreatePostRequestMetadataToJSONTyped(json, false);
}
export function CreatePostRequestMetadataToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'priority': CreatePostRequestMetadataPriorityToJSON(value['priority']),
    };
}
