import { test } from "node:test";
import assert from "node:assert/strict";
import { signRequest } from "../src/storage/sigv4.ts";

// "Example: GET Object" from the AWS S3 API reference (Signature Version 4, header auth).
test("SigV4 matches the AWS S3 GET Object example", () => {
  const { signature, headers } = signRequest({
    method: "GET",
    host: "examplebucket.s3.amazonaws.com",
    path: "/test.txt",
    headers: { range: "bytes=0-9" },
    payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    amzDate: "20130524T000000Z",
    region: "us-east-1",
    service: "s3",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  });
  assert.equal(signature, "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  assert.match(headers.authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date/);
});
