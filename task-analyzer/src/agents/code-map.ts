/**
 * Agent 2: CodeMap
 *
 * Input:  decomposedUnits[], businessQueries[]
 * Output: codeMap[] (files + symbols per task)
 *
 * Runs ChromaDB (fast vector) and GitNexus (deep graph) in PARALLEL
 * for each task's keywords, then merges results.
 */

import * as chromadb from '../core/chromadb.js';
import * as gitnexus from '../core/gitnexus.js';
import { log } from '../utils.js';
import type { AnalysisStateType, CodeMapEntry } from './state.js';

export async function codeMapAgent(
  state: AnalysisStateType
): Promise<Partial<AnalysisStateType>> {
  const units = state.decomposedUnits ?? [];
  log.info(`[CodeMap] Mapping ${units.length} units to codebase`);

  const entries: CodeMapEntry[] = [];

  for (const unit of units) {
    const searchTerms = [
      ...unit.keywords,
      ...unit.modules,
      ...unit.apis,
    ].filter(Boolean);

    const files = new Set<string>();
    const symbols = new Set<string>();

    // Parallel: search all terms via ChromaDB + GitNexus
    const searches = searchTerms.slice(0, 8).map((term) =>
      searchTerm(state.projectId, state.chromaPath, term, files, symbols)
    );

    // Also match business queries to this task
    for (const q of state.businessQueries ?? []) {
      const titleWords = unit.taskTitle.toLowerCase().split(/\s+/);
      const qWords = q.toLowerCase().split(/\s+/);
      const overlap = qWords.filter((w) => titleWords.includes(w)).length;
      if (overlap >= 2) {
        searches.push(
          searchTerm(state.projectId, state.chromaPath, q, files, symbols)
        );
      }
    }

    await Promise.all(searches);

    entries.push({
      taskId: unit.taskId,
      files: [...files].slice(0, 30),
      symbols: [...symbols].slice(0, 20),
    });
  }

  log.info(`[CodeMap] Total: ${entries.reduce((s, e) => s + e.files.length, 0)} files mapped`);
  return { codeMap: entries };
}

// ─── Helper: search single term in both backends ───

async function searchTerm(
  projectId: string,
  chromaPath: string,
  term: string,
  files: Set<string>,
  symbols: Set<string>
): Promise<void> {
  try {
    const [chromaResults, gnResults] = await Promise.all([
      chromadb.queryCodeContext(chromaPath, projectId, term, 5),
      gitnexus.query(projectId, term),
    ]);

    for (const r of chromaResults) {
      const path = r.metadata?.path ?? r.id;
      if (path) files.add(path);
    }

    for (const s of gnResults.symbols ?? []) {
      if (s.filePath) files.add(s.filePath);
      if (s.name) symbols.add(s.name);
    }
  } catch {
    // Silently continue — one backend down shouldn't block
  }
}
