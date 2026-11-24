export interface PostMetadataEmbedsInner {
    type?: PostMetadataEmbedsInnerTypeEnum;
    url?: string;
    data?: object;
}
export declare const PostMetadataEmbedsInnerTypeEnum: {
    readonly Image: 'image';
    readonly MessageAttachment: 'message_attachment';
    readonly Opengraph: 'opengraph';
    readonly Link: 'link';
};
export type PostMetadataEmbedsInnerTypeEnum = typeof PostMetadataEmbedsInnerTypeEnum[keyof typeof PostMetadataEmbedsInnerTypeEnum];
export declare function instanceOfPostMetadataEmbedsInner(value: object): value is PostMetadataEmbedsInner;
export declare function PostMetadataEmbedsInnerFromJSON(json: any): PostMetadataEmbedsInner;
export declare function PostMetadataEmbedsInnerFromJSONTyped(json: any, ignoreDiscriminator: boolean): PostMetadataEmbedsInner;
export declare function PostMetadataEmbedsInnerToJSON(json: any): PostMetadataEmbedsInner;
export declare function PostMetadataEmbedsInnerToJSONTyped(value?: PostMetadataEmbedsInner | null, ignoreDiscriminator?: boolean): any;
