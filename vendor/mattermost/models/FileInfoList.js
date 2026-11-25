import { mapValues } from '../runtime.js';
import { FileInfoFromJSON, FileInfoToJSON, } from './FileInfo.js';
export function instanceOfFileInfoList(value) {
    if (!('order' in value) || value['order'] === undefined)
        return false;
    if ((!('fileInfos' in value) && !('file_infos' in value)) || (value['fileInfos'] === undefined && value['file_infos'] === undefined))
        return false;
    if ((!('nextFileInfoId' in value) && !('next_file_info_id' in value)) || (value['nextFileInfoId'] === undefined && value['next_file_info_id'] === undefined))
        return false;
    if ((!('prevFileInfoId' in value) && !('prev_file_info_id' in value)) || (value['prevFileInfoId'] === undefined && value['prev_file_info_id'] === undefined))
        return false;
    if ((!('firstInaccessibleFileTime' in value) && !('first_inaccessible_file_time' in value)) || (value['firstInaccessibleFileTime'] === undefined && value['first_inaccessible_file_time'] === undefined))
        return false;
    return true;
}
export function FileInfoListFromJSON(json) {
    return FileInfoListFromJSONTyped(json, false);
}
export function FileInfoListFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'order': json['order'],
        'fileInfos': (mapValues(json['file_infos'], FileInfoFromJSON)),
        'nextFileInfoId': json['next_file_info_id'],
        'prevFileInfoId': json['prev_file_info_id'],
        'firstInaccessibleFileTime': json['first_inaccessible_file_time'],
    };
}
export function FileInfoListToJSON(json) {
    return FileInfoListToJSONTyped(json, false);
}
export function FileInfoListToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'order': value['order'],
        'file_infos': (mapValues(value['fileInfos'], FileInfoToJSON)),
        'next_file_info_id': value['nextFileInfoId'],
        'prev_file_info_id': value['prevFileInfoId'],
        'first_inaccessible_file_time': value['firstInaccessibleFileTime'],
    };
}
