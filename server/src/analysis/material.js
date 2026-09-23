/**
 * Small, deliberately conservative wording checks for already matched functions.
 * Findings are review signals, not legal conclusions. Every fragment is sliced
 * from the original text; unknown wording and ambiguous repeated actions are skipped.
 */

const normalize = (value) => value.toLocaleLowerCase('ru').replaceAll('ё', 'е');
const ACTIONS = [
  ['осуществлять', /^осуществля(?:ет|ют|ть|ется|ются)$/u],
  ['проводить', /^(?:провод(?:ит|ят|ить|ится|ятся)|провести)$/u],
  ['согласовывать', /^согласовыва(?:ет|ют|ть|ется|ются)$/u],
  ['утверждать', /^утвержда(?:ет|ют|ть|ется|ются)$/u],
  ['одобрять', /^одобря(?:ет|ют|ть|ется|ются)$/u],
  ['предоставлять', /^предоставля(?:ет|ют|ть|ется|ются)$/u],
  ['представлять', /^представля(?:ет|ют|ть|ется|ются)$/u],
  ['направлять', /^направля(?:ет|ют|ть|ется|ются)$/u],
  ['формировать', /^формир(?:ует|уют|овать|уется|уются)$/u],
  ['контролировать', /^контролир(?:ует|уют|овать|уется|уются)$/u],
  ['проверять', /^проверя(?:ет|ют|ть|ется|ются)$/u],
  ['обеспечивать', /^обеспечива(?:ет|ют|ть|ется|ются)$/u],
  ['участвовать', /^участв(?:ует|уют|овать)$/u],
  ['выполнять', /^выполня(?:ет|ют|ть|ется|ются)$/u],
  ['принимать', /^принима(?:ет|ют|ть|ется|ются)$/u],
  ['рассматривать', /^рассматрива(?:ет|ют|ть|ется|ются)$/u],
  ['отвечать', /^отвеча(?:ет|ют|ть)$/u],
  ['подписывать', /^подписыва(?:ет|ют|ть|ется|ются)$/u],
  ['получать', /^получа(?:ет|ют|ть|ется|ются)$/u],
  ['передавать', /^(?:переда(?:ет|ют|вать|ется|ются)|передать)$/u],
  ['нести', /^(?:несет|несут|нести)$/u],
  ['вести', /^(?:ведет|ведут|вести|ведется|ведутся)$/u],
  ['допускать', /^допуска(?:ет|ют|ть|ется|ются)$/u],
  ['разрешать', /^разреша(?:ет|ют|ть|ется|ются)$/u],
];
const REQUIRED = /^(?:обязан|обязана|обязано|обязаны|должен|должна|должно|должны)$/u;
const PERMITTED = /^(?:вправе|может|могут|разрешено|разрешается|разрешаются|допускается|допускаются)$/u;
const FORBIDDEN = /^(?:запрещено|запрещается|запрещаются)$/u;
const FREQUENCIES = new Map([
  ['ежедневно', 'day:1'], ['еженедельно', 'week:1'],
  ['ежемесячно', 'month:1'], ['ежеквартально', 'month:3'],
  ['ежегодно', 'month:12'],
]);

function tokenize(text) {
  return [...text.matchAll(/\d+(?:[.,]\d+)*|[\p{L}\p{M}]+/gu)]
    .map((match) => ({ word: normalize(match[0]), start: match.index, end: match.index + match[0].length }));
}

function action(word) {
  return ACTIONS.find(([, pattern]) => pattern.test(word))?.[0] ?? null;
}

function sameSentence(text, left, right) {
  return !/[.;!?\n]/u.test(text.slice(left.end, right.start));
}

function fragment(text, tokens, start, end) {
  let last = start;
  for (let i = start + 1; i <= Math.min(end, tokens.length - 1); i += 1) {
    if (!sameSentence(text, tokens[i - 1], tokens[i])) break;
    last = i;
  }
  return text.slice(tokens[start].start, tokens[last].end);
}

// A stable action anchors each signal. If an action
// repeats in a clause, pairing is skipped instead of guessing its target.
function actionEvents(text, tokens) {
  return tokens.flatMap((token, index) => {
    const key = action(token.word);
    return key ? [{ key, index, fragment: fragment(text, tokens, index, index + 4) }] : [];
  });
}

function uniquePairs(before, after) {
  return before.flatMap((item) => {
    const left = before.filter((candidate) => candidate.key === item.key);
    const right = after.filter((candidate) => candidate.key === item.key);
    return left.length === 1 && right.length === 1 ? [[item, right[0]]] : [];
  });
}

function nearestAction(text, tokens, actions, tokenIndex) {
  const candidates = actions.filter(({ index }) => {
    const first = Math.min(index, tokenIndex), last = Math.max(index, tokenIndex);
    return Math.abs(index - tokenIndex) <= 12 && sameSentence(text, tokens[first], tokens[last]);
  }).sort((a, b) => Math.abs(a.index - tokenIndex) - Math.abs(b.index - tokenIndex));
  if (!candidates.length) return null;
  if (candidates[1] && Math.abs(candidates[0].index - tokenIndex) === Math.abs(candidates[1].index - tokenIndex)) return null;
  // Uniqueness concerns the underlying action, not merely the number of
  // marked periods/scopes: otherwise a marker can silently jump to another object.
  if (actions.filter((item) => item.key === candidates[0].key).length !== 1) return null;
  return candidates[0];
}

function modalEvents(text, tokens) {
  return tokens.flatMap((token, index) => {
    if (!REQUIRED.test(token.word) && !PERMITTED.test(token.word) && !FORBIDDEN.test(token.word)) return [];
    const negative = tokens[index - 1]?.word === 'не' && sameSentence(text, tokens[index - 1], token);
    let actionIndex = -1;
    for (let i = index + 1; i < Math.min(index + 7, tokens.length); i += 1) {
      if (!sameSentence(text, tokens[index], tokens[i])) break;
      if (action(tokens[i].word) || /(?:ть|ться)$/u.test(tokens[i].word)) { actionIndex = i; break; }
    }
    if (actionIndex < 0) return [];
    const negativeAction = tokens[actionIndex - 1]?.word === 'не' && sameSentence(text, tokens[actionIndex - 1], tokens[actionIndex]);
    let state = REQUIRED.test(token.word) ? 'required' : FORBIDDEN.test(token.word) ? 'forbidden' : 'permitted';
    if (negative) {
      // «Не обязан» and «не должен» do not express reliably equivalent duties.
      // Preserve that wording distinction without declaring its legal effect.
      state = state === 'required' ? (/^обязан/u.test(token.word) ? 'not-required' : 'negative-duty')
        : state === 'permitted' ? 'forbidden' : 'not-forbidden';
    }
    if (negativeAction) state = state === 'required' ? 'forbidden' : `${state}-negative`;
    return [{
      key: action(tokens[actionIndex].word) ?? tokens[actionIndex].word,
      state, index: actionIndex, markerIndex: index,
      fragment: fragment(text, tokens, negative ? index - 1 : index, actionIndex + 3),
    }];
  });
}

function timeEvents(text, tokens, actions) {
  const events = [];
  const add = (start, end, signature) => {
    const index = tokens.findIndex((token) => token.start >= start);
    const anchor = nearestAction(text, tokens, actions, index);
    if (anchor) events.push({ key: anchor.key, signature, fragment: text.slice(start, end) });
  };
  for (const token of tokens) {
    if (FREQUENCIES.has(token.word)) add(token.start, token.end, FREQUENCIES.get(token.word));
  }
  // A time preposition is mandatory: clause numbers, sums and percentages are
  // never interpreted as changed deadlines. Calendar and working days differ.
  const period = /(?<![\p{L}\d])(?<prefix>в\s+течение|не\s+позднее|не\s+ранее|не\s+реже|не\s+чаще|раз\s+в|каждые|каждый|каждую|через|до|за)\s+(?<amount>\d+(?:[,.]\d+)?)\s+(?:(?<qualifier>рабочих|рабочие|рабочий|календарных|календарные|календарный)\s+)?(?<unit>дней|дня|день|суток|сутки|недель|недели|неделю|неделя|месяцев|месяца|месяц|кварталов|квартала|квартал|лет|года|год|часов|часа|час)(?![\p{L}\d])/giu;
  for (const match of text.matchAll(period)) {
    const groups = match.groups;
    const unit = normalize(groups.unit);
    const dimension = /^(?:д|сут)/u.test(unit) ? 'day' : /^нед/u.test(unit) ? 'week' : /^час/u.test(unit) ? 'hour' : 'month';
    const multiplier = /^кварт/u.test(unit) ? 3 : /^(?:лет|год)/u.test(unit) ? 12 : 1;
    const amount = Number(groups.amount.replace(',', '.')) * multiplier;
    const prefix = normalize(groups.prefix).replace(/\s+/gu, ' ');
    // Only pure cadence markers can be compared with ежемесячно, etc.
    const mode = /^(?:раз в|кажд)/u.test(prefix) ? '' : `${prefix}:`;
    const qualifier = groups.qualifier ? (/^рабоч/u.test(normalize(groups.qualifier)) ? 'working:' : 'calendar:') : '';
    add(match.index, match.index + match[0].length, `${mode}${qualifier}${dimension}:${amount}`);
  }
  return events;
}

function scopeEvents(text, tokens, actions) {
  return tokens.flatMap((token, index) => {
    if (!/^(?:только|все|всех|всеми|отдельные|отдельных|отдельными|выборочные|выборочных|выборочными)$/u.test(token.word)) return [];
    if (tokens[index - 1]?.word === 'не') return [];
    const anchor = nearestAction(text, tokens, actions, index);
    if (!anchor || !tokens[index + 1] || !sameSentence(text, token, tokens[index + 1])) return [];
    return [{ key: `${anchor.key}:${tokens[index + 1].word}`, state: /^(?:все|всех|всеми)$/u.test(token.word) ? 'all' : 'limited', fragment: fragment(text, tokens, index, index + 3) }];
  });
}

/** @returns {{kind: string, title: string, detail: string, beforeFragment: string, afterFragment: string}[]} */
export function inspectMaterialChanges(beforeText, afterText) {
  if (typeof beforeText !== 'string' || typeof afterText !== 'string' || !beforeText.trim() || !afterText.trim()) return [];
  if (normalize(beforeText) === normalize(afterText)) return [];
  const beforeTokens = tokenize(beforeText), afterTokens = tokenize(afterText);
  const beforeActions = actionEvents(beforeText, beforeTokens), afterActions = actionEvents(afterText, afterTokens);
  const beforeModals = modalEvents(beforeText, beforeTokens), afterModals = modalEvents(afterText, afterTokens);
  const findings = [];
  const add = (kind, title, detail, beforeFragment, afterFragment) => findings.push({ kind, title, detail, beforeFragment, afterFragment });

  for (const [before, after] of uniquePairs(beforeActions, afterActions)) {
    // Modal + infinitive form one statement, including «обязан не делать».
    // Compare the complete modal context instead of reporting its «не» twice.
    if (beforeModals.some((item) => item.index === before.index)
      && afterModals.some((item) => item.index === after.index)) continue;
    // «Не допускается подписывать» is one change, covered by the modal rule
    // on «подписывать». A stand-alone «не допускается» still uses this rule.
    if (PERMITTED.test(beforeTokens[before.index].word) && PERMITTED.test(afterTokens[after.index].word)
      && beforeModals.some((item) => item.markerIndex === before.index)
      && afterModals.some((item) => item.markerIndex === after.index)) continue;
    const beforeNegative = beforeTokens[before.index - 1]?.word === 'не' && sameSentence(beforeText, beforeTokens[before.index - 1], beforeTokens[before.index]);
    const afterNegative = afterTokens[after.index - 1]?.word === 'не' && sameSentence(afterText, afterTokens[after.index - 1], afterTokens[after.index]);
    if (Boolean(beforeNegative) === Boolean(afterNegative)) continue;
    add('prohibition', 'Изменено отрицание действия', 'У сопоставленного действия добавлено или убрано «не». Проверьте, изменилось ли полномочие или ограничение.',
      fragment(beforeText, beforeTokens, before.index - (beforeNegative ? 1 : 0), before.index + 4),
      fragment(afterText, afterTokens, after.index - (afterNegative ? 1 : 0), after.index + 4));
  }

  for (const [before, after] of uniquePairs(beforeModals, afterModals)) {
    if (before.state === after.state) continue;
    const prohibition = [before.state, after.state].some((state) => state.includes('forbidden'));
    add(prohibition ? 'prohibition' : 'obligation', prohibition ? 'Изменена формулировка запрета' : 'Изменена обязательность действия',
      prohibition ? 'Для одного действия изменена формулировка разрешения или запрета. Требуется содержательная проверка.' : 'Для одного действия изменена формулировка обязанности или возможности. Проверьте обязательность исполнения.',
      before.fragment, after.fragment);
  }

  for (const [before, after] of uniquePairs(timeEvents(beforeText, beforeTokens, beforeActions), timeEvents(afterText, afterTokens, afterActions))) {
    if (before.signature === after.signature) continue;
    add('frequency', 'Изменён срок или периодичность', 'У сопоставленного действия различаются явно указанные сроки или периодичность. Проверьте новый порядок исполнения.', before.fragment, after.fragment);
  }

  for (const [before, after] of uniquePairs(scopeEvents(beforeText, beforeTokens, beforeActions), scopeEvents(afterText, afterTokens, afterActions))) {
    if (before.state !== after.state) add('scope', 'Изменён охват функции', 'Перед одним объектом изменён ограничитель охвата. Проверьте состав объектов, на которые распространяется функция.', before.fragment, after.fragment);
  }
  return findings;
}
