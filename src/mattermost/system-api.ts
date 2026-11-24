import { Configuration, SystemApi } from "../../vendor/mattermost/index.js";
import { createRestTransport } from "./rest-transport.ts";

export function createSystemApi(serverUrl: string, send: typeof fetch) {
  return new SystemApi(new Configuration(createRestTransport(serverUrl, send)));
}
