import { type BlockInput, type Graph, type Issue, type RisksInput, stepText } from './schema';
import type { Block, ContextBlock, OptionBlock } from './types';

const ACRONYM = /\b[A-Z][A-Z0-9]{1,5}s?\b/g;
const COMMON_ACRONYMS = new Set([
  'API',
  'URL',
  'HTTP',
  'HTTPS',
  'JSON',
  'UI',
  'CLI',
  'ID',
  'SQL',
  'CSS',
  'HTML',
  'JS',
  'TS',
]);

function graphTexts(graph: Graph, path: string) {
  return [
    ...graph.nodes.map((node, i) => ({ path: `${path}.nodes.${i}.label`, text: node.label })),
    ...graph.edges.map((edge, i) => ({ path: `${path}.edges.${i}.label`, text: edge.label })),
  ];
}

type AcronymScope = {
  context: Pick<ContextBlock, 'goal' | 'summary' | 'terms' | 'flows'>;
  options: Pick<OptionBlock, 'name' | 'pattern' | 'summary' | 'why' | 'diagram'>[];
  risks?: RisksInput;
};

export function undefinedAcronyms(plan: AcronymScope): Issue[] {
  const terms = plan.context.terms.map((t) => t.term.toLowerCase());
  const texts = [
    { path: 'context.goal', text: plan.context.goal },
    { path: 'context.summary', text: plan.context.summary },
    ...plan.context.flows.flatMap((flow, f) => [
      ...flow.steps.map((step, i) => ({ path: `context.flows.${f}.steps.${i}`, text: stepText(step) })),
      ...(flow.diagram === undefined ? [] : graphTexts(flow.diagram, `context.flows.${f}.diagram`)),
    ]),
    ...plan.options.flatMap((option, i) => [
      { path: `options.${i}.name`, text: option.name },
      { path: `options.${i}.pattern`, text: option.pattern },
      { path: `options.${i}.summary`, text: option.summary },
      { path: `options.${i}.why`, text: option.why },
      ...graphTexts(option.diagram, `options.${i}.diagram`),
    ]),
    ...(plan.risks?.items ?? []).map((item, i) => ({ path: `risks.items.${i}.text`, text: item.text })),
  ];
  return texts.flatMap(({ path, text }) => {
    const undefinedHere = new Set(
      Array.from(text?.matchAll(ACRONYM) ?? [], ([token]) => token.replace(/s$/, '')).filter(
        (acronym) => !COMMON_ACRONYMS.has(acronym) && !terms.some((term) => term.includes(acronym.toLowerCase())),
      ),
    );
    return Array.from(undefinedHere, (acronym) => ({ path, message: `define ${acronym} in context.terms` }));
  });
}

/** Checks an option or risks patch against the current context terms, and a context patch's own text and every option against its new terms. */
export function patchAcronyms(blocks: Block[], blockId: string, input: BlockInput): Issue[] {
  const context = blocks.find((b): b is ContextBlock => b.kind === 'context');
  if (context === undefined || blocks.find((b) => b.id === blockId)?.kind !== input.kind) return [];
  if (input.kind === 'option') {
    return undefinedAcronyms({ context, options: [input] })
      .filter(({ path }) => path.startsWith('options.'))
      .map((issue) => ({ ...issue, path: issue.path.slice('options.0.'.length) }));
  }
  if (input.kind === 'risks') {
    return undefinedAcronyms({ context, options: [], risks: input })
      .filter(({ path }) => path.startsWith('risks.'))
      .map((issue) => ({ ...issue, path: issue.path.slice('risks.'.length) }));
  }
  if (input.kind !== 'context') return [];
  const options = blocks.filter((b): b is OptionBlock => b.kind === 'option');
  return undefinedAcronyms({ context: input, options }).map((issue) => ({
    ...issue,
    path: issue.path.replace(/^context\./, ''),
  }));
}
