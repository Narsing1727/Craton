"use client";

// The code block takes render functions as children, and a function can't cross from a server
// component to a client one. So the block, with its functions, lives here on the client side and
// the page just says "show this".

import {
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockFiles,
  CodeBlockHeader,
  CodeBlockItem,
  type BundledLanguage,
} from "@/components/kibo-ui/code-block";

const data = [
  {
    language: "json",
    filename: "409 Conflict",
    code: `{\n  "error": {\n    "code": "checks_failing",\n    "message": "Checks are failing on this branch."\n  }\n}`,
  },
];

export function ErrorExample() {
  return (
    <CodeBlock defaultValue="json" data={data} className="mt-3">
      <CodeBlockHeader>
        <CodeBlockFiles>
          {(item) => (
            <CodeBlockFilename key={item.language} value={item.language}>
              {item.filename}
            </CodeBlockFilename>
          )}
        </CodeBlockFiles>
        <CodeBlockCopyButton />
      </CodeBlockHeader>
      <CodeBlockBody>
        {(item) => (
          <CodeBlockItem key={item.language} value={item.language}>
            <CodeBlockContent language={item.language as BundledLanguage}>{item.code}</CodeBlockContent>
          </CodeBlockItem>
        )}
      </CodeBlockBody>
    </CodeBlock>
  );
}
