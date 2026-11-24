export interface SidebarCategoryWithChannels {
    id?: string;
    userId?: string;
    teamId?: string;
    displayName?: string;
    type?: SidebarCategoryWithChannelsTypeEnum;
    channelIds?: Array<string>;
    sortOrder?: number;
    sorting?: string;
    muted?: boolean;
    collapsed?: boolean;
}
export declare const SidebarCategoryWithChannelsTypeEnum: {
    readonly Channels: 'channels';
    readonly Custom: 'custom';
    readonly DirectMessages: 'direct_messages';
    readonly Favorites: 'favorites';
    readonly Managed: 'managed';
};
export type SidebarCategoryWithChannelsTypeEnum = typeof SidebarCategoryWithChannelsTypeEnum[keyof typeof SidebarCategoryWithChannelsTypeEnum];
export declare function instanceOfSidebarCategoryWithChannels(value: object): value is SidebarCategoryWithChannels;
export declare function SidebarCategoryWithChannelsFromJSON(json: any): SidebarCategoryWithChannels;
export declare function SidebarCategoryWithChannelsFromJSONTyped(json: any, ignoreDiscriminator: boolean): SidebarCategoryWithChannels;
export declare function SidebarCategoryWithChannelsToJSON(json: any): SidebarCategoryWithChannels;
export declare function SidebarCategoryWithChannelsToJSONTyped(value?: SidebarCategoryWithChannels | null, ignoreDiscriminator?: boolean): any;
