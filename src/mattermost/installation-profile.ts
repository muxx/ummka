import {
  type ApiResponse,
  Configuration,
  SystemApi,
} from "../../vendor/mattermost/index.js";
import type { createRestTransport } from "./rest-transport.ts";

const configFields = [
  "Version",
  "SiteName",
  "EnableSignInWithEmail",
  "EnableSignInWithUsername",
  "EnableLdap",
  "EnableSignUpWithGitLab",
  "EnableSignUpWithGoogle",
  "EnableSignUpWithOffice365",
  "EnableSignUpWithOpenId",
  "EnableSaml",
  "EnableGuestMagicLink",
] as const;

function invalid() {
  return new TypeError("Invalid Mattermost installation profile");
}

export async function readStringFields<K extends string>(
  request: Promise<ApiResponse<void>>,
  fields: readonly K[],
) {
  const { raw } = await request;
  let data: unknown;
  try {
    data = await raw.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw invalid();
    throw error;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data))
    throw invalid();
  const source = data as Record<string, unknown>;
  const values: Partial<Record<K, string>> = {};
  for (const field of fields) {
    if (!Object.hasOwn(source, field)) continue;
    const value = source[field];
    if (typeof value !== "string") throw invalid();
    values[field] = value;
  }
  return values;
}

function enabled<K extends string>(choices: [K, boolean][]): K[] {
  return choices.filter(([, allowed]) => allowed).map(([name]) => name);
}

export async function loadInstallationProfile(
  { basePath, fetchApi }: ReturnType<typeof createRestTransport>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const pair = new AbortController();
  const options = {
    signal: signal ? AbortSignal.any([signal, pair.signal]) : pair.signal,
  };
  const api = new SystemApi(new Configuration({ basePath, fetchApi }));
  const params = { format: "old" };
  try {
    const [config, license] = await Promise.all([
      readStringFields(
        api.getClientConfigRaw(params, options),
        configFields,
      ).then((settings) => {
        if (!settings.Version?.trim()) throw invalid();
        return { ...settings, Version: settings.Version };
      }),
      readStringFields(api.getClientLicenseRaw(params, options), [
        "IsLicensed",
        "LDAP",
        "SAML",
      ] as const).then((settings) => {
        if (settings.IsLicensed !== "true" && settings.IsLicensed !== "false")
          throw invalid();
        return settings;
      }),
    ]);
    signal?.throwIfAborted();
    const licensed = license.IsLicensed === "true";
    return {
      version: config.Version,
      siteName: config.SiteName ?? "",
      passwordIdentifiers: enabled([
        ["email", config.EnableSignInWithEmail === "true"],
        ["username", config.EnableSignInWithUsername === "true"],
        [
          "ldap",
          licensed && license.LDAP === "true" && config.EnableLdap === "true",
        ],
      ]),
      ssoProviders: enabled([
        ["gitlab", config.EnableSignUpWithGitLab === "true"],
        ["google", config.EnableSignUpWithGoogle === "true"],
        ["office365", config.EnableSignUpWithOffice365 === "true"],
        ["openid", config.EnableSignUpWithOpenId === "true"],
        [
          "saml",
          licensed && license.SAML === "true" && config.EnableSaml === "true",
        ],
      ]),
      guestMagicLink: config.EnableGuestMagicLink === "true",
    };
  } catch (error) {
    // Both response bodies belong to this operation, including a generated HTTP error.
    pair.abort();
    signal?.throwIfAborted();
    throw error;
  }
}
