export interface Timezone {
    useAutomaticTimezone?: boolean;
    manualTimezone?: string;
    automaticTimezone?: string;
}
export declare function instanceOfTimezone(value: object): value is Timezone;
export declare function TimezoneFromJSON(json: any): Timezone;
export declare function TimezoneFromJSONTyped(json: any, ignoreDiscriminator: boolean): Timezone;
export declare function TimezoneToJSON(json: any): Timezone;
export declare function TimezoneToJSONTyped(value?: Timezone | null, ignoreDiscriminator?: boolean): any;
