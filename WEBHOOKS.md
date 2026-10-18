# Receiving Craton webhooks

A delivery is an HTTPS `POST` with a JSON body and three headers in the Standard Webhooks scheme:

| Header | What it is |
| --- | --- |
| `webhook-id` | A message id, the same on every retry of that message. Use it to ignore duplicates. |
| `webhook-timestamp` | Unix seconds when this attempt was signed. Reject anything more than five minutes off. |
| `webhook-signature` | One or more space-separated `v1,<base64>` signatures. |

The signature is HMAC-SHA256, keyed with the secret's bytes (the part after `whsec_`, base64-decoded), over the string
`<webhook-id>.<webhook-timestamp>.<raw body>`, then base64-encoded. Verify against the **raw body**, before parsing it,
and compare in constant time.

The body is `{ id, type, createdAt, repository: { owner, name, visibility }, data }`; the fields of `data` for each
event are listed in the API reference under Webhook events. Answer with any 2xx within ten seconds; anything else is
retried with growing delays.

`craton webhook verify` checks a delivery from the command line when you are debugging a receiver.

## Node.js

```js
const { createHmac, timingSafeEqual } = require("node:crypto");

// secret: "whsec_..." from when the webhook was created. headers: the request's headers. rawBody: the body as received.
function verify(secret, headers, rawBody) {
  const id = headers["webhook-id"], timestamp = headers["webhook-timestamp"];
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = "v1," + createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  return String(headers["webhook-signature"]).split(" ").some((s) => {
    const a = Buffer.from(s), b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
module.exports = { verify };
```

## Python

```python
import base64, hashlib, hmac, time

def verify(secret: str, headers: dict, raw_body: str) -> bool:
    """secret: "whsec_..." ; headers: the request's headers (lower-case names); raw_body: the body as received."""
    if abs(time.time() - int(headers["webhook-timestamp"])) > 300:
        return False
    key = base64.b64decode(secret.removeprefix("whsec_"))
    message = f'{headers["webhook-id"]}.{headers["webhook-timestamp"]}.{raw_body}'.encode()
    expected = "v1," + base64.b64encode(hmac.new(key, message, hashlib.sha256).digest()).decode()
    return any(hmac.compare_digest(s, expected) for s in headers["webhook-signature"].split(" "))
```
