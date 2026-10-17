// Merkle tree over a commit's files. The root commits to every path and every chunk hash,
// so it proves every byte of a snapshot. LOCUS audits cite this root.
//
// Leaves are domain-separated from inner nodes (0x00 / 0x01 prefixes) to rule out
// second-preimage tricks where an inner node is passed off as a leaf.

import { createHash } from "node:crypto";

const h = (...parts: (string | Buffer)[]) => {
  const hash = createHash("sha256");
  for (const p of parts) hash.update(p);
  return hash.digest();
};

export const leafHash = (path: string, blobId: string) => h(Buffer.from([0]), path, "\0", blobId);
const nodeHash = (a: Buffer, b: Buffer) => h(Buffer.from([1]), a, b);

/** Root of the tree built from leaves in the given order (odd nodes are carried up unchanged). */
export function merkleRoot(leaves: Buffer[]): string {
  if (leaves.length === 0) return h("craton-empty-tree").toString("hex");
  let level = leaves;
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? nodeHash(level[i], level[i + 1]) : level[i]);
    }
    level = next;
  }
  return level[0].toString("hex");
}

export type ProofStep = { sibling: string; side: "left" | "right" };

/** Inclusion proof for leaf `index`: lets an auditor verify one file against the root alone. */
export function merkleProof(leaves: Buffer[], index: number): ProofStep[] {
  const proof: ProofStep[] = [];
  let level = leaves;
  let i = index;
  while (level.length > 1) {
    const isRight = i % 2 === 1;
    const siblingIndex = isRight ? i - 1 : i + 1;
    if (siblingIndex < level.length) {
      proof.push({ sibling: level[siblingIndex].toString("hex"), side: isRight ? "left" : "right" });
    }
    const next: Buffer[] = [];
    for (let k = 0; k < level.length; k += 2) {
      next.push(k + 1 < level.length ? nodeHash(level[k], level[k + 1]) : level[k]);
    }
    level = next;
    i = Math.floor(i / 2);
  }
  return proof;
}

/**
 * Inclusion proofs for every leaf at once. `merkleProof` rebuilds the whole tree for each leaf (quadratic in the number
 * of files); this builds each level once and reads every leaf's sibling from it, with the same results.
 */
export function merkleProofs(leaves: Buffer[]): ProofStep[][] {
  const proofs: ProofStep[][] = leaves.map(() => []);
  let level = leaves;
  // position[j] is where leaf j currently sits in `level`.
  const position = leaves.map((_, j) => j);
  while (level.length > 1) {
    for (let j = 0; j < leaves.length; j++) {
      const i = position[j];
      const isRight = i % 2 === 1;
      const siblingIndex = isRight ? i - 1 : i + 1;
      if (siblingIndex < level.length) proofs[j].push({ sibling: level[siblingIndex].toString("hex"), side: isRight ? "left" : "right" });
      position[j] = Math.floor(i / 2);
    }
    const next: Buffer[] = [];
    for (let k = 0; k < level.length; k += 2) next.push(k + 1 < level.length ? nodeHash(level[k], level[k + 1]) : level[k]);
    level = next;
  }
  return proofs;
}

export function verifyProof(leaf: Buffer, proof: ProofStep[], root: string): boolean {
  let acc = leaf;
  for (const step of proof) {
    const sibling = Buffer.from(step.sibling, "hex");
    acc = step.side === "left" ? nodeHash(sibling, acc) : nodeHash(acc, sibling);
  }
  return acc.toString("hex") === root;
}
