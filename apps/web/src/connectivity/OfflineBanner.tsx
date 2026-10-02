/**
 * オフラインの帯（B-70 設計 4章・5章 / 6章 規則4・5・15 / FR-41 / `docs/screen-design.md` 9章）。
 *
 * **文言はここだけに置く。** 正は `docs/design/README.md`「案内の帯」（ADR-074）。
 *
 * **`role="status"` を持つ**（規則4）— 利用者の操作と無関係に、見ている間に操作が止まるため、
 * 読み上げに伝える。出すかどうかは門（`App.tsx`）が決め、ここは描くだけである。
 */

import styles from './OfflineBanner.module.css';

export function OfflineBanner() {
  return (
    <p role="status" className={styles.banner}>
      オフラインです
    </p>
  );
}
