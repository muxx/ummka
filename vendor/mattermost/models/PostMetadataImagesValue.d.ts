export interface PostMetadataImagesValue {
    height?: number;
    width?: number;
    format?: string;
    frameCount?: number;
}
export declare function instanceOfPostMetadataImagesValue(value: object): value is PostMetadataImagesValue;
export declare function PostMetadataImagesValueFromJSON(json: any): PostMetadataImagesValue;
export declare function PostMetadataImagesValueFromJSONTyped(json: any, ignoreDiscriminator: boolean): PostMetadataImagesValue;
export declare function PostMetadataImagesValueToJSON(json: any): PostMetadataImagesValue;
export declare function PostMetadataImagesValueToJSONTyped(value?: PostMetadataImagesValue | null, ignoreDiscriminator?: boolean): any;
