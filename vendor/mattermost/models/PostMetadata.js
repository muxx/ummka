import { mapValues } from '../runtime.js';
import { FileInfoFromJSON, FileInfoToJSON, } from './FileInfo.js';
import { PostMetadataImagesValueFromJSON, PostMetadataImagesValueToJSON, } from './PostMetadataImagesValue.js';
import { EmojiFromJSON, EmojiToJSON, } from './Emoji.js';
import { PostMetadataEmbedsInnerFromJSON, PostMetadataEmbedsInnerToJSON, } from './PostMetadataEmbedsInner.js';
import { PostAcknowledgementFromJSON, PostAcknowledgementToJSON, } from './PostAcknowledgement.js';
import { ReactionFromJSON, ReactionToJSON, } from './Reaction.js';
import { PostMetadataPriorityFromJSON, PostMetadataPriorityToJSON, } from './PostMetadataPriority.js';
export function instanceOfPostMetadata(value) {
    return true;
}
export function PostMetadataFromJSON(json) {
    return PostMetadataFromJSONTyped(json, false);
}
export function PostMetadataFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'embeds': json['embeds'] == null ? undefined : (json['embeds'].map(PostMetadataEmbedsInnerFromJSON)),
        'emojis': json['emojis'] == null ? undefined : (json['emojis'].map(EmojiFromJSON)),
        'files': json['files'] == null ? undefined : (json['files'].map(FileInfoFromJSON)),
        'images': json['images'] == null ? undefined : (mapValues(json['images'], PostMetadataImagesValueFromJSON)),
        'reactions': json['reactions'] == null ? undefined : (json['reactions'].map(ReactionFromJSON)),
        'priority': json['priority'] == null ? undefined : PostMetadataPriorityFromJSON(json['priority']),
        'acknowledgements': json['acknowledgements'] == null ? undefined : (json['acknowledgements'].map(PostAcknowledgementFromJSON)),
        'redactedFileCount': json['redacted_file_count'] == null ? undefined : json['redacted_file_count'],
    };
}
export function PostMetadataToJSON(json) {
    return PostMetadataToJSONTyped(json, false);
}
export function PostMetadataToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'embeds': value['embeds'] == null ? undefined : (value['embeds'].map(PostMetadataEmbedsInnerToJSON)),
        'emojis': value['emojis'] == null ? undefined : (value['emojis'].map(EmojiToJSON)),
        'files': value['files'] == null ? undefined : (value['files'].map(FileInfoToJSON)),
        'images': value['images'] == null ? undefined : (mapValues(value['images'], PostMetadataImagesValueToJSON)),
        'reactions': value['reactions'] == null ? undefined : (value['reactions'].map(ReactionToJSON)),
        'priority': PostMetadataPriorityToJSON(value['priority']),
        'acknowledgements': value['acknowledgements'] == null ? undefined : (value['acknowledgements'].map(PostAcknowledgementToJSON)),
        'redacted_file_count': value['redactedFileCount'],
    };
}
