export interface Preference {
    userId?: string;
    category?: string;
    name?: string;
    value?: string;
}
export declare function instanceOfPreference(value: object): value is Preference;
export declare function PreferenceFromJSON(json: any): Preference;
export declare function PreferenceFromJSONTyped(json: any, ignoreDiscriminator: boolean): Preference;
export declare function PreferenceToJSON(json: any): Preference;
export declare function PreferenceToJSONTyped(value?: Preference | null, ignoreDiscriminator?: boolean): any;
