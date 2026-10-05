import type { Graph, Issue, PlanInput } from './schema';

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

export function undefinedAcronyms(plan: PlanInput): Issue[] {
  const terms = plan.context.terms.map((t) => t.term.toLowerCase());
  const texts = [
    { path: 'context.summary', text: plan.context.summary },
    ...plan.context.flows.flatMap((flow, f) => [
      ...flow.steps.map((step, i) => ({ path: `context.flows.${f}.steps.${i}`, text: step })),
      ...(flow.diagram === undefined ? [] : graphTexts(flow.diagram, `context.flows.${f}.diagram`)),
    ]),
    ...plan.options.flatMap((option, i) => [
      { path: `options.${i}.name`, text: option.name },
      { path: `options.${i}.pattern`, text: option.pattern },
      { path: `options.${i}.summary`, text: option.summary },
      { path: `options.${i}.why`, text: option.why },
      ...graphTexts(option.diagram, `options.${i}.diagram`),
    ]),
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
