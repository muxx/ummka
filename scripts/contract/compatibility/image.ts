import { createServer } from "node:http";

// A single 4 x 3 PNG with one solid colour.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGMQcGiAIwacHAC5BwnB/EwENwAAAABJRU5ErkJggg==",
  "base64",
);
createServer((request, response) => {
  if (request.url !== "/sample.png") {
    response.writeHead(404).end();
    return;
  }
  response
    .writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": png.byteLength,
    })
    .end(png);
}).listen(8099, "0.0.0.0");
