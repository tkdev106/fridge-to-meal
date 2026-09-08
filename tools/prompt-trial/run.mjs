#!/usr/bin/env node
// 献立生成プロンプトの試行ツール。docs/prompt-design.md 第9章・第10章に対応する。
// アプリ本体ではない。使い方は tools/prompt-trial/README.md を参照。

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYSTEM_PROMPT, RESPONSE_SCHEMA, buildUserMessage, skipReason } from './lib/prompt.mjs';
import { validate } from './lib/validate.mjs';
import { score } from './lib/score.mjs';
import { PROVIDERS } from './lib/providers.mjs';
import { estimateCost, USD_JPY } from './lib/pricing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(join(HERE, p), 'utf8'));

function parseArgs(argv) {
  const out = { provider: 'anthropic', runs: 1, count: 3, maxTokens: 2048, effort: 'low' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--provider') out.provider = next();
    else if (a === '--model') out.model = next();
    else if (a === '--patterns') out.patterns = next().split(',').map((s) => s.trim());
    else if (a === '--runs') out.runs = Number(next());
    else if (a === '--count') out.count = Number(next());
    else if (a === '--max-tokens') out.maxTokens = Number(next());
    else if (a === '--effort') out.effort = next();
    else if (a === '--temperature') out.temperature = Number(next());
    else if (a === '--avoid') out.avoid = Number(next());
    else if (a === '--structured') out.structured = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--count-tokens') out.countTokens = true;
    else if (a === '--self-test') out.selfTest = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`不明な引数: ${a}`);
  }
  return out;
}

const HELP = `献立生成プロンプトの試行ツール

  node tools/prompt-trial/run.mjs [options]

  --provider <name>   anthropic | google | openai （既定: anthropic）
  --model <id>        既定はプロバイダごとの推奨モデル
  --patterns P-1,P-2  試すパターン（既定: 全部）
  --runs <n>          パターンごとの試行回数（既定: 1。設計上の推奨は3）
  --count <n>         生成させる件数（既定: 3）
  --max-tokens <n>    出力の上限（既定: 2048）
  --effort <level>    anthropic のみ。low|medium|high（既定: low）
  --temperature <n>   対応プロバイダのみ。Claude Opus 5 / Sonnet 5 は受け付けない
  --avoid <n>         避けたい献立の件数を上書き（Q-6 の検証用。0 / 20 / 50）
  --structured        構造化出力を使う（ADR-019 の比較軸1）
  --dry-run           API を呼ばず、組み立てたプロンプトと文字数だけ出す
  --count-tokens      入力トークンだけ実測する（anthropic のみ・生成しない）
  --self-test         検証器の動作確認だけ行う（API 不要）

  API キーは環境変数から読む: ANTHROPIC_API_KEY / GOOGLE_API_KEY / OPENAI_API_KEY
`;

function resolvePattern(pattern, all) {
  if (pattern.stock) return pattern.stock;
  const base = all.find((p) => p.id === pattern.stockFrom);
  if (!base) throw new Error(`stockFrom が見つからない: ${pattern.stockFrom}`);
  return base.stock;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }
  if (args.selfTest) { selfTest(); return; }

  const { patterns: all } = readJson('fixtures/patterns.json');
  const { titles: avoidPool } = readJson('fixtures/avoid-titles.json');
  const provider = PROVIDERS[args.provider];
  if (!provider) throw new Error(`不明なプロバイダ: ${args.provider}`);
  const model = args.model ?? provider.defaultModel;

  const targets = args.patterns ? all.filter((p) => args.patterns.includes(p.id)) : all;
  if (targets.length === 0) throw new Error('該当するパターンがない');

  const live = !args.dryRun;
  if (live && !process.env[provider.envKey]) {
    throw new Error(`${provider.envKey} が設定されていない（--dry-run なら不要）`);
  }

  const startedAt = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join(HERE, 'runs', `${startedAt}_${args.provider}_${model}`);
  const results = [];

  for (const pattern of targets) {
    const stock = resolvePattern(pattern, all);
    const avoidCount = args.avoid ?? pattern.useAvoidTitles ?? 0;
    const avoidTitles = avoidPool.slice(0, avoidCount);
    const user = buildUserMessage({ stock, requiredCount: args.count, avoidTitles });

    const skip = skipReason(stock);
    if (skip) {
      console.log(`[${pattern.id}] 生成を呼ばない条件に該当: ${skip}`);
      results.push({ pattern: pattern.id, skipped: skip });
      continue;
    }

    if (args.dryRun) {
      console.log(`\n===== ${pattern.id} ${pattern.name} =====`);
      console.log(`[system] ${SYSTEM_PROMPT.length} 文字 / [user] ${user.length} 文字 / 避けたい献立 ${avoidCount} 件`);
      console.log(user);
      continue;
    }

    if (args.countTokens) {
      if (!provider.countTokens) throw new Error(`${args.provider} は --count-tokens に対応していない`);
      const systemTokens = await provider.countTokens({ model, system: SYSTEM_PROMPT, user: '.' });
      const total = await provider.countTokens({ model, system: SYSTEM_PROMPT, user });
      console.log(`[${pattern.id}] 入力 ${total} tokens（うち system 約 ${systemTokens}、避けたい献立 ${avoidCount} 件）`);
      results.push({ pattern: pattern.id, inputTokens: total, systemTokens, avoidCount });
      continue;
    }

    for (let run = 1; run <= args.runs; run += 1) {
      const t0 = Date.now();
      let raw = '';
      let usage = null;
      let error = null;
      let stopReason = null;
      try {
        const res = await provider.generate({
          model,
          system: SYSTEM_PROMPT,
          user,
          maxTokens: args.maxTokens,
          effort: args.provider === 'anthropic' ? args.effort : undefined,
          schema: args.structured ? RESPONSE_SCHEMA : undefined,
          temperature: args.temperature,
        });
        raw = res.text;
        usage = res.usage;
        stopReason = res.stopReason;
      } catch (e) {
        error = e.message;
      }
      const elapsedMs = Date.now() - t0;

      const verdict = error
        ? { ok: false, meals: [], failure: `API エラー: ${error}`, discarded: [] }
        : validate(raw, { requiredCount: args.count, precedingTitles: avoidTitles.slice(0, 3) });
      const metrics = verdict.ok ? score({ stock, meals: verdict.meals, avoidTitles, discarded: verdict.discarded }) : null;
      const cost = usage ? estimateCost(model, usage.input ?? 0, usage.output ?? 0) : null;

      const record = {
        pattern: pattern.id, patternName: pattern.name, run, provider: args.provider, model,
        avoidCount, elapsedMs, usage, cost, stopReason,
        ok: verdict.ok, failure: verdict.failure, discarded: verdict.discarded,
        metrics, meals: verdict.meals, raw,
      };
      results.push(record);
      mkdirSync(join(outDir, 'raw'), { recursive: true });
      writeFileSync(join(outDir, 'raw', `${pattern.id}_${run}.json`), JSON.stringify(record, null, 2));
      console.log(`[${pattern.id}] run ${run}: ${verdict.ok ? `${verdict.meals.length}件` : `失敗 (${verdict.failure})`} / ${elapsedMs}ms`);
    }
  }

  if (args.dryRun) return;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  const summary = renderSummary(results, { provider: args.provider, model, args });
  writeFileSync(join(outDir, 'summary.md'), summary);
  console.log(`\n${summary}\n保存先: ${outDir}`);
}

/** 第9.3章の記録様式。 */
function renderSummary(results, { provider, model, args }) {
  const rows = results.filter((r) => r.metrics || r.failure);
  const head = [
    `# 試行結果 ${provider} / ${model}`,
    '',
    `- 生成件数の指示: ${args.count} / 出力上限: ${args.maxTokens}${args.structured ? ' / 構造化出力: あり' : ''}`,
    `- 為替: 1 USD = ${USD_JPY} 円`,
    '',
    '| パターン | 回 | 検証 | 件数 | 材料名一致 | 表記ゆれ疑い | 種別の倒し込み | 調味料(うちリスト外) | 期限遵守 | 調理法 | 不足材料(中央値) | 名称一致の重複 | 入力tok | 出力tok | 円 | 秒 |',
    '| --- | --: | --- | --: | --: | --: | --: | --: | --- | --: | --: | --: | --: | --: | --: | --: |',
  ];
  const pct = (v) => (v === null || v === undefined ? '-' : `${Math.round(v * 100)}%`);
  const body = rows.map((r) => {
    const m = r.metrics;
    const urgent = m?.usesUrgentIngredient;
    return `| ${r.pattern} | ${r.run ?? '-'} | ${r.ok ? 'OK' : 'NG'} | ${m?.mealCount ?? '-'} | `
      + `${pct(m?.ingredientNameMatchRate)} | ${m?.variantSuspects ?? '-'} | ${m?.kindCorrections ?? '-'} | `
      + `${m ? `${m.seasoningTotal}(${m.seasoningOffList})` : '-'} | `
      + `${urgent === null || urgent === undefined ? '-' : (urgent ? 'あり' : 'なし')} | `
      + `${m?.distinctCookingMethods ?? '-'} | ${m?.missingMedian ?? '-'} | ${m?.exactAvoidHits ?? '-'} | `
      + `${r.usage?.input ?? '-'} | ${r.usage?.output ?? '-'} | ${r.cost ? r.cost.jpy.toFixed(2) : '-'} | `
      + `${r.elapsedMs ? (r.elapsedMs / 1000).toFixed(1) : '-'} |`;
  });
  const failures = rows.filter((r) => !r.ok).map((r) => `- ${r.pattern} run ${r.run}: ${r.failure}`);
  const tail = [
    '',
    `検証通過率: ${rows.length ? Math.round((rows.filter((r) => r.ok).length / rows.length) * 100) : 0}%`,
    '',
    '**人が見る項目（自動では測らない）**: 意味的な重複の有無、「今日これを作るか」と思えるか、リストにない調味料が正しく seasoning になっているか。',
  ];
  if (failures.length) tail.push('', '## 失敗', ...failures);
  return [...head, ...body, ...tail].join('\n');
}

/** API を使わない自己診断。検証規則が壊れていないかを確かめる。 */
function selfTest() {
  const ing = (name, kind) => ({ name, amount: '1個', ...(kind ? { kind } : {}) });
  const meal = (title, ingredients, steps = ['焼く']) => ({ title, ingredients, steps });
  const wrap = (meals) => JSON.stringify({ meals });

  let failed = 0;
  const check = (name, cond) => {
    if (!cond) failed += 1;
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  };

  // --- 抽出と構造 ---
  check('前置き＋コードブロックを剥がせる',
    validate('はい。\n```json\n' + wrap([meal('卵とじ', [ing('卵', 'main')])]) + '\n```', { requiredCount: 3 }).ok);
  check('JSON でなければ失敗', !validate('すみません、提案できません。', { requiredCount: 3 }).ok);
  check('meals が配列でなければ失敗', !validate('{"meals":{}}', { requiredCount: 3 }).ok);
  check('title が空なら捨てる',
    !validate(wrap([meal('  ', [ing('卵', 'main')])]), { requiredCount: 3 }).ok);

  // --- 材料の種別（C-16 / ADR-023）---
  const listed = validate(wrap([meal('A', [ing('卵', 'main'), ing('醤油', 'main')])]), { requiredCount: 3 });
  check('リストにある調味料は main 申告でも seasoning に倒す',
    listed.ok && listed.meals[0].ingredients.find((i) => i.name === '醤油')?.kind === 'seasoning');

  const offList = validate(wrap([meal('A', [ing('卵', 'main'), ing('オイスターソース', 'seasoning')])]), { requiredCount: 3 });
  check('リストにない調味料も seasoning のまま受け入れる',
    offList.ok && offList.meals[0].ingredients.find((i) => i.name === 'オイスターソース')?.kind === 'seasoning');

  const notReverted = validate(wrap([meal('A', [ing('卵', 'main'), ing('ナンプラー', 'seasoning')])]), { requiredCount: 3 });
  check('リストにない調味料を main に戻さない（倒し込みは片側だけ）',
    notReverted.meals[0].ingredients.find((i) => i.name === 'ナンプラー')?.kind === 'seasoning');

  const missingKind = validate(wrap([meal('A', [ing('卵'), ing('謎の粉', 'unknown')])]), { requiredCount: 3 });
  check('kind の欠落と不正値は main に倒す',
    missingKind.ok && missingKind.meals[0].ingredients.every((i) => i.kind === 'main'));

  check('主材料が0件なら捨てる',
    !validate(wrap([meal('A', [ing('醤油', 'seasoning')])]), { requiredCount: 3 }).ok);

  // --- 件数（6.4）---
  const many = validate(wrap(['A', 'B', 'C', 'D'].map((t) => meal(t, [ing('卵', 'main')]))), { requiredCount: 3 });
  check('4件返っても先頭3件に切り詰める', many.meals.length === 3 && many.meals[0].title === 'A');

  const few = validate(wrap([meal('A', [ing('卵', 'main')])]), { requiredCount: 3 });
  check('1件でも提案を組む', few.ok && few.meals.length === 1);

  // --- 重複と直前の提案（FR-36）---
  const dup = validate(wrap([meal('A', [ing('卵', 'main')]), meal('A', [ing('豆腐', 'main')])]), { requiredCount: 3 });
  check('同じ応答内の title 重複は後を捨てる', dup.meals.length === 1);

  const preceding = validate(wrap([meal('A', [ing('卵', 'main')])]), { requiredCount: 3, precedingTitles: ['A'] });
  check('直前の提案と同名は捨てる', !preceding.ok);

  console.log(failed === 0 ? '\nすべて通過' : `\n${failed} 件失敗`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((e) => { console.error(`エラー: ${e.message}`); process.exitCode = 1; });
