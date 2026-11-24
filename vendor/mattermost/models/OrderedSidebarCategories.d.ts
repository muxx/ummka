import type { SidebarCategoryWithChannels } from './SidebarCategoryWithChannels.js';
export interface OrderedSidebarCategories {
    order?: Array<string>;
    categories?: Array<SidebarCategoryWithChannels>;
}
export declare function instanceOfOrderedSidebarCategories(value: object): value is OrderedSidebarCategories;
export declare function OrderedSidebarCategoriesFromJSON(json: any): OrderedSidebarCategories;
export declare function OrderedSidebarCategoriesFromJSONTyped(json: any, ignoreDiscriminator: boolean): OrderedSidebarCategories;
export declare function OrderedSidebarCategoriesToJSON(json: any): OrderedSidebarCategories;
export declare function OrderedSidebarCategoriesToJSONTyped(value?: OrderedSidebarCategories | null, ignoreDiscriminator?: boolean): any;
