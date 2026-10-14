import { Message } from "./share-shell";

// A link that is wrong, expired or switched off. All three look the same on purpose.
export default function SharedNotFound() {
  return <Message title="This link doesn’t exist or has expired" body="Ask the person who sent it to make you a new one." />;
}
