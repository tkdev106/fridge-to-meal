# shared/api

HTTP 層（各コンテキストの `api/`）が共有する、**最小限の部品だけ**を置く。

いまあるのは `UnexpectedFailureLog`（500 に畳む失敗のログ。ADR-080）のみ。`shared/` は `contexts/` を
import しない（ADR-059）。**迷ったら置かない。**
