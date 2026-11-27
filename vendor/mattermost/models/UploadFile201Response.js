import { FileInfoFromJSON, FileInfoToJSON, } from './FileInfo.js';
export function instanceOfUploadFile201Response(value) {
    return true;
}
export function UploadFile201ResponseFromJSON(json) {
    return UploadFile201ResponseFromJSONTyped(json, false);
}
export function UploadFile201ResponseFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'fileInfos': json['file_infos'] == null ? undefined : (json['file_infos'].map(FileInfoFromJSON)),
        'clientIds': json['client_ids'] == null ? undefined : json['client_ids'],
    };
}
export function UploadFile201ResponseToJSON(json) {
    return UploadFile201ResponseToJSONTyped(json, false);
}
export function UploadFile201ResponseToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'file_infos': value['fileInfos'] == null ? undefined : (value['fileInfos'].map(FileInfoToJSON)),
        'client_ids': value['clientIds'],
    };
}
