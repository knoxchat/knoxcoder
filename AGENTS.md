<!-- Copyright (c) KnoxStudio. All rights reserved. Licensed under the GNU GPL-3.0 License. -->

# Agent notes for KnoxCoder

## Never embeddings, vector DB, or neural rerank

Knox memory, recipes, and code search stay **local lexical retrieval**: sqlite FTS, BM25, trigrams, rule-based synonyms, graph walk.

Do **not** add, enable, or depend on:

- Vector databases, embedding indexes, or embedding columns
- Cloud or local embedding APIs / ONNX embedding models
- Neural / cross-encoder / LLM rerank of memories, recipes, or code hits

If a bench miss has no shared tokens, expand honest synonym groups or accept the miss. RecipeMatcher “rerank by track record” is ordinary score math (success/revert counts) and is allowed. ML rerank is not.

See `extensions/knox/docs/knox-memory-checkpoint.md`.
