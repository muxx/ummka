import type { FileInfo } from './FileInfo.js';
export interface ChannelBookmarkWithFileInfo {
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
    type?: ChannelBookmarkWithFileInfoTypeEnum;
    targetId?: string;
    originalId?: string;
    parentId?: string;
    file?: FileInfo;
}
export declare const ChannelBookmarkWithFileInfoTypeEnum: {
    readonly Link: 'link';
    readonly File: 'file';
    readonly Board: 'board';
};
export type ChannelBookmarkWithFileInfoTypeEnum = typeof ChannelBookmarkWithFileInfoTypeEnum[keyof typeof ChannelBookmarkWithFileInfoTypeEnum];
export declare function instanceOfChannelBookmarkWithFileInfo(value: object): value is ChannelBookmarkWithFileInfo;
export declare function ChannelBookmarkWithFileInfoFromJSON(json: any): ChannelBookmarkWithFileInfo;
export declare function ChannelBookmarkWithFileInfoFromJSONTyped(json: any, ignoreDiscriminator: boolean): ChannelBookmarkWithFileInfo;
export declare function ChannelBookmarkWithFileInfoToJSON(json: any): ChannelBookmarkWithFileInfo;
export declare function ChannelBookmarkWithFileInfoToJSONTyped(value?: ChannelBookmarkWithFileInfo | null, ignoreDiscriminator?: boolean): any;
