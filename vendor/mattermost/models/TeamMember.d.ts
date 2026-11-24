export interface TeamMember {
    teamId?: string;
    userId?: string;
    roles?: string;
    deleteAt?: number;
    schemeUser?: boolean;
    schemeAdmin?: boolean;
    explicitRoles?: string;
    schemeGuest?: boolean;
}
export declare function instanceOfTeamMember(value: object): value is TeamMember;
export declare function TeamMemberFromJSON(json: any): TeamMember;
export declare function TeamMemberFromJSONTyped(json: any, ignoreDiscriminator: boolean): TeamMember;
export declare function TeamMemberToJSON(json: any): TeamMember;
export declare function TeamMemberToJSONTyped(value?: TeamMember | null, ignoreDiscriminator?: boolean): any;
