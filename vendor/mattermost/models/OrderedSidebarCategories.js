import { SidebarCategoryWithChannelsFromJSON, SidebarCategoryWithChannelsToJSON, } from './SidebarCategoryWithChannels.js';
export function instanceOfOrderedSidebarCategories(value) {
    return true;
}
export function OrderedSidebarCategoriesFromJSON(json) {
    return OrderedSidebarCategoriesFromJSONTyped(json, false);
}
export function OrderedSidebarCategoriesFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'order': json['order'] == null ? undefined : json['order'],
        'categories': json['categories'] == null ? undefined : (json['categories'].map(SidebarCategoryWithChannelsFromJSON)),
    };
}
export function OrderedSidebarCategoriesToJSON(json) {
    return OrderedSidebarCategoriesToJSONTyped(json, false);
}
export function OrderedSidebarCategoriesToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'order': value['order'],
        'categories': value['categories'] == null ? undefined : (value['categories'].map(SidebarCategoryWithChannelsToJSON)),
    };
}
