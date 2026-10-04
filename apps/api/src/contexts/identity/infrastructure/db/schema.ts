import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authUsers } from 'drizzle-orm/supabase';

/**
 * 世帯の参加（`HouseholdMember`）と招待（`HouseholdInvitation`）の2表の正（ADR-029 決定2 /
 * ADR-087 決定1）。**SQL を先に書いて、ここを後追いさせない。**
 * マイグレーションは `pnpm --filter @fridge-to-meal/api db:generate` で生成する。
 *
 * **2表は関数だけを通す表である**（ADR-087 決定3）。`authenticated` に直接読み書きさせず、
 * 世帯は `private.current_household_id()` だけが引く。生成物には、RLS の有効化（強制はしない）・
 * ポリシーを置かないこと・`anon` と `authenticated` からの取り上げを手で足す。手順は
 * `supabase/migrations/README.md`、落ちないことの守りは
 * `apps/api/test/migrations/tableMigrations.test.ts`。
 *
 * **ここは `drizzle-orm` 以外を import しない。** ドメインの型を持ち込まず、ドメインへ渡しもしない。
 */

/**
 * 利用者がどの世帯に参加しているか（ADR-087 決定1）。**行の無い利用者の世帯は自分の利用者 ID**
 * であり、既存の利用者のために行を作らない（同 理由(2)）。利用者1人につき1行なので
 * `user_id` を主キーにする。
 */
export const householdMembers = pgTable('household_members', {
  /** 利用者を消すと参加の行も一緒に消える（ADR-087 決定2・6 / ADR-071）。 */
  userId: uuid('user_id')
    .primaryKey()
    .references(() => authUsers.id, { onDelete: 'cascade' }),

  /** 既定値を置かない。値がそのまま世帯 ID である（ADR-087 決定1）。 */
  householdId: uuid('household_id').notNull(),
});

/**
 * 世帯への招待（ADR-087 決定1）。表だけを置き、読み書きする関数は B-74 で置く。
 */
export const householdInvitations = pgTable('household_invitations', {
  token: text('token').primaryKey(),

  householdId: uuid('household_id').notNull(),

  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
});
