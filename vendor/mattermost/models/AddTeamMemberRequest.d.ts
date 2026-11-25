export interface AddTeamMemberRequest {
    teamId: string;
    userId: string;
}
export declare function instanceOfAddTeamMemberRequest(value: object): value is AddTeamMemberRequest;
export declare function AddTeamMemberRequestFromJSON(json: any): AddTeamMemberRequest;
export declare function AddTeamMemberRequestFromJSONTyped(json: any, ignoreDiscriminator: boolean): AddTeamMemberRequest;
export declare function AddTeamMemberRequestToJSON(json: any): AddTeamMemberRequest;
export declare function AddTeamMemberRequestToJSONTyped(value?: AddTeamMemberRequest | null, ignoreDiscriminator?: boolean): any;
