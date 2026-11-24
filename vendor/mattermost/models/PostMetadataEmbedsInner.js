export const PostMetadataEmbedsInnerTypeEnum = {
    Image: 'image',
    MessageAttachment: 'message_attachment',
    Opengraph: 'opengraph',
    Link: 'link',
};
export function instanceOfPostMetadataEmbedsInner(value) {
    return true;
}
export function PostMetadataEmbedsInnerFromJSON(json) {
    return PostMetadataEmbedsInnerFromJSONTyped(json, false);
}
export function PostMetadataEmbedsInnerFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'type': json['type'] == null ? undefined : json['type'],
        'url': json['url'] == null ? undefined : json['url'],
        'data': json['data'] == null ? undefined : json['data'],
    };
}
export function PostMetadataEmbedsInnerToJSON(json) {
    return PostMetadataEmbedsInnerToJSONTyped(json, false);
}
export function PostMetadataEmbedsInnerToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'type': value['type'],
        'url': value['url'],
        'data': value['data'],
    };
}
