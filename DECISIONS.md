# Craton decisions

Open questions from the design doc that the backend needed an answer to. Each default below
was chosen as the safest reversible option while you were away; each one is a single setting
in `backend/src/config.ts`. Change the value and restart the server.

## 1. Plan limits (pricing)

- **Question:** the pricing page says 5 GB free and $19/seat Team; the design doc says 20 GB free and $7 / $20.
- **Default:** the backend reads plan limits from `config.plans`, set to the **design doc numbers**
  (free 20 GB stored after deduplication). The pricing page was **not** changed, so the two
  currently disagree on purpose until you pick one.
- **To change:** edit `config.plans`, and the tiers in `frontend/app/pricing/page.tsx`.

## 2. Format normalization on upload

- **Question:** convert uploads to COG / COPC / Zarr, or keep byte-identical originals?
- **Default:** **byte-identical originals.** Craton stores exactly the bytes you pushed, chunked
  on raw bytes and compressed losslessly (zstd). A clone reproduces every file bit for bit, and
  its SHA-256 matches the original. Nothing is rewritten, so nothing can be silently altered,
  which matches the design doc's "engineers won't trust it" rule for lossy modes.
- **Why this default:** normalization can be added later as an optional *derived* copy (a
  preview or COG sidecar) without changing stored history; the reverse isn't possible.
- **Setting:** `config.normalizeOnIngest = false`. There is no normalization code yet.

## 3. Deduplication scope for private data

- **Question:** can a private chunk be deduplicated against another customer's data?
- **Default:** **cross-account deduplication covers public data only.** A private repository
  can reference public chunks for free, but its own chunks are only matched within the same
  owner. When a client asks "which of these chunks do you already have?", the server answers
  only for chunks the requester may see (public, plus its own owner's). Otherwise that question
  would reveal whether someone else stored a given file.
- **Storage detail:** bytes are still stored once physically. If you upload a chunk that exists
  elsewhere privately, you must send the bytes (proving you have them); the server verifies the
  hash and records the chunk in your scope without storing it twice.
- **Setting:** `config.dedupScope = "public-plus-owner"`.

## Also decided while building (not open questions in the doc)

- Transfers use HTTPS only for now; the adaptive QUIC path is future work.
- History is append-only: pushes must fast-forward, there is no force push, and revert creates a
  new commit.
- The CLI checks that a file's size and modification time are stable before reading it, so it
  never reads a file another program (e.g. HEC-RAS) is still writing.
- Object storage: local disk by default (`data/`), Cloudflare R2 when `R2_*` environment
  variables are set.
