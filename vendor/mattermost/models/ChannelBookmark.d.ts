export interface ChannelBookmark {
    id?: string;
    createAt?: number;
    updateAt?: number;
    deleteAt?: number;
    channelId?: string;
    ownerId?: string;
    fileId?: string;
    displayName?: string;
    sortOrder?: number;
    linkUrl?: string;
    imageUrl?: string;
    emoji?: string;
    type?: ChannelBookmarkTypeEnum;
    targetId?: string;
    originalId?: string;
    parentId?: string;
}
export declare const ChannelBookmarkTypeEnum: {
    readonly Link: 'link';
    readonly File: 'file';
    readonly Board: 'board';
};
export type ChannelBookmarkTypeEnum = typeof ChannelBookmarkTypeEnum[keyof typeof ChannelBookmarkTypeEnum];
export declare function instanceOfChannelBookmark(value: object): value is ChannelBookmark;
export declare function ChannelBookmarkFromJSON(json: any): ChannelBookmark;
export declare function ChannelBookmarkFromJSONTyped(json: any, ignoreDiscriminator: boolean): ChannelBookmark;
export declare function ChannelBookmarkToJSON(json: any): ChannelBookmark;
export declare function ChannelBookmarkToJSONTyped(value?: ChannelBookmark | null, ignoreDiscriminator?: boolean): any;
