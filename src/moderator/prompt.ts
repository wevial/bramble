import type { State } from '../orchestrator/state.js';
import type { Persona } from '../personas/personas.js';

export function moderatorPrompt(args: {
  state: State;
  personas: Persona[];
  contextWindow: number;
}): string {
  const { state, personas, contextWindow } = args;
  const lines: string[] = [];

  lines.push('You are the moderator of a multi-agent design debate.');
  lines.push('');
  lines.push(
    "Your only job is to pick which agent should speak next. You do not edit the spec, you do not answer questions, you do not chat. You output a single JSON object and nothing else.",
  );
  lines.push('');
  lines.push(`Current phase: ${state.phase}.`);
  lines.push(`Original user prompt: ${state.prompt}`);
  lines.push('');

  lines.push('## Eligible agents');
  for (const p of personas) {
    const role = p.systemPrompt.split('.')[0]?.trim() ?? p.label;
    lines.push(`- "${p.id}" — ${p.label}: ${role}`);
  }
  lines.push('');

  lines.push(`## Last ${contextWindow} turns (oldest first)`);
  const log =
    state.phase === 'interview' ? state.interview : state.debate;
  const recent = log.slice(-contextWindow);
  if (recent.length === 0) {
    lines.push('(no turns yet — pick whichever agent should kick off)');
  } else {
    for (const t of recent) {
      const tail =
        'question' in t
          ? t.question
            ? `Q: ${t.question}`
            : t.ready
              ? '(ready)'
              : '(no question)'
          : `verdict=${t.verdict}, edits=${t.edits.length}`;
      const commentary = t.commentary
        ? ` — ${t.commentary.slice(0, 200)}`
        : '';
      lines.push(`- ${t.speaker}: ${tail}${commentary}`);
    }
  }
  lines.push('');

  lines.push('## Decision criteria');
  lines.push('- Pick the agent whose expertise most matches the most recent turn.');
  lines.push('- Avoid picking the agent who just spoke unless they explicitly need to follow up.');
  lines.push('- Prefer agents who haven\'t spoken recently when no domain signal is strong.');
  lines.push('- Do NOT bias toward agents that share your transport — judge purely on fit.');
  lines.push('');

  lines.push('## Output');
  lines.push('Reply with one JSON object on a single line, no prose, no fences:');
  lines.push('  {"next": "<persona id from the eligible list>", "reason": "<one short sentence>"}');
  lines.push('');
  lines.push('The "reason" is shown to the user as an attribution under the next speaker, so make it concrete (e.g. "auth section needs a security review", not "looks important").');

  return lines.join('\n');
}
