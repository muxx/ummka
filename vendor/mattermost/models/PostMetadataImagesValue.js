export function instanceOfPostMetadataImagesValue(value) {
    return true;
}
export function PostMetadataImagesValueFromJSON(json) {
    return PostMetadataImagesValueFromJSONTyped(json, false);
}
export function PostMetadataImagesValueFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'height': json['height'] == null ? undefined : json['height'],
        'width': json['width'] == null ? undefined : json['width'],
        'format': json['format'] == null ? undefined : json['format'],
        'frameCount': json['frame_count'] == null ? undefined : json['frame_count'],
    };
}
export function PostMetadataImagesValueToJSON(json) {
    return PostMetadataImagesValueToJSONTyped(json, false);
}
export function PostMetadataImagesValueToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'height': value['height'],
        'width': value['width'],
        'format': value['format'],
        'frame_count': value['frameCount'],
    };
}
