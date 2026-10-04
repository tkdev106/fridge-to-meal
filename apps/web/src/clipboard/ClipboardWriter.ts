/** 文字を写した結末。 */
export type CopyOutcome = 'copied' | 'failed';

/** 文字を写す継ぎ目（FR-44）。例外を投げない。 */
export type ClipboardWriter = { writeText(text: string): Promise<CopyOutcome> };
