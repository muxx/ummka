import assert from "node:assert/strict";

export async function uploadFixtureFile(
  basePath: string,
  authorization: Record<string, string>,
  channel: string,
  name: string,
  contents: string,
) {
  const data = new FormData();
  data.set("channel_id", channel);
  data.set("files", new Blob([contents], { type: "text/plain" }), name);
  const upload = await fetch(`${basePath}/api/v4/files`, {
    method: "POST",
    headers: authorization,
    body: data,
  });
  assert.equal(upload.status, 201, "Upload fixture attachment");
  const id: unknown = (await upload.json()).file_infos[0].id;
  assert.ok(typeof id === "string" && id.length === 26);
  return id;
}
