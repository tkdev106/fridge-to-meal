# clipboard

**ここは画面ではない。** `features/` が画面の置き場であるのに対し、ここは文字を写す**継ぎ目**である
（先行 `connectivity/`）。`navigator.clipboard` をこの背後に閉じ、**画面が見るのは
`ClipboardWriter.ts` の型だけである**（FR-44）。

| ファイル | 役割 |
| --- | --- |
| `ClipboardWriter.ts` | 画面が見る唯一の型。写せた・写せなかったの2つを返し、例外を投げない |
| `ClipboardWriterImpl.ts` | `navigator.clipboard` の写し。`navigator` は構造型 `ClipboardNavigator` で受け、DOM の型を口に出さない |

- **`new ClipboardWriterImpl(navigator)` を書くのは `main.tsx` だけ。** ここは何も import しない
- clipboard が無いときも書き込みが拒まれたときも `failed` に畳む。そのときにどう案内するかは画面の判断である
- `ClipboardWriterImpl` は判断（clipboard の有無・拒否の畳み方）を持つので、偽の clipboard で単体テストを置く
  （`test/clipboard/`）
