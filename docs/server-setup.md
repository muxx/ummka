# Browser sign-in on a self-hosted Mattermost server

ummka opens GitLab and other configured SSO providers in the system browser. After sign-in, Mattermost returns the session to `io.github.muxx.ummka.auth://callback`. An administrator must allow the ummka scheme on each Mattermost installation where people use browser sign-in.

## Allow the return to ummka

1. Open the active server configuration with `mmctl config edit`, or edit `config.json` if that file is the configuration source for your deployment.
2. In `NativeAppSettings.AppCustomURLSchemes`, append `io.github.muxx.ummka.auth://`. Keep every existing entry. With the Mattermost 10.10.1 defaults the array becomes:

   ```json
   ["mmauth://", "mmauthbeta://", "io.github.muxx.ummka.auth://"]
   ```
3. Apply the configuration using your deployment's usual process. Retry the provider button in ummka.

If your deployment manages this setting through the environment, update `MM_NATIVEAPPSETTINGS_APPCUSTOMURLSCHEMES` in the deployment configuration and restart the affected Mattermost instances. Mattermost 10.10.1 reads the entries as **space-separated** strings. For the default entries plus ummka:

```yaml
MM_NATIVEAPPSETTINGS_APPCUSTOMURLSCHEMES: "mmauth:// mmauthbeta:// io.github.muxx.ummka.auth://"
```

## Recognize this error

A Mattermost page saying **Invalid custom url scheme has been provided** means the server rejected the return address before opening the SSO provider. In the 10.10.1 System Console the similarly named **Custom URL Schemes** field controls clickable schemes in messages. Browser sign-in uses the separate native-app setting above. [Native defaults](https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/config.go#L306-L308) · [SSO handler](https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/web/oauth.go#L465-L478) · [System Console setting](https://github.com/mattermost/mattermost/blob/v10.10.1/webapp/channels/src/components/admin_console/admin_definition.tsx#L3165-L3172) · [Environment parsing](https://github.com/mattermost/mattermost/blob/v10.10.1/server/config/environment.go#L73-L80)
