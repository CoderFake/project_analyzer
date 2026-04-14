/**
 * LangGraph Builder — Compiles the 5-agent analysis pipeline
 *
 * Graph:
 *   START → Decompose → CodeMap → [GapAnalysis?] → Impact → Report → END
 *
 * GapAnalysis is CONDITIONAL — only runs when specText is provided.
 * LLM config is decrypted ONCE before invoke, passed through state.
 */

import { END, START, StateGraph } from '@langchain/langgraph';
import { codeMapAgent } from './code-map.js';
import { decomposeAgent } from './decompose.js';
import { gapAnalysisAgent } from './gap-analysis.js';
import { impactAgent } from './impact.js';
import { reportAgent } from './report.js';
import { AnalysisState } from './state.js';

export function buildAnalysisGraph() {
  const graph = new StateGraph(AnalysisState)
    .addNode('decompose', decomposeAgent)
    .addNode('codeMap', codeMapAgent)
    .addNode('gapAnalysis', gapAnalysisAgent)
    .addNode('impact', impactAgent)
    .addNode('report', reportAgent)

    // ── Edges ──
    .addEdge(START, 'decompose')
    .addEdge('decompose', 'codeMap')

    // Conditional: skip gap analysis if no spec text
    .addConditionalEdges('codeMap', (state) => {
      return state.specText?.length > 0 ? 'gapAnalysis' : 'impact';
    })

    .addEdge('gapAnalysis', 'impact')
    .addEdge('impact', 'report')
    .addEdge('report', END);

  return graph.compile();
}

// Singleton compiled graph
let _compiledGraph: ReturnType<typeof buildAnalysisGraph> | null = null;

export function getAnalysisGraph() {
  if (!_compiledGraph) {
    _compiledGraph = buildAnalysisGraph();
  }
  return _compiledGraph;
}
