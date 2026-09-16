// Frozen before inference. This suite models editor capture, not repository search.
// No expected answer or case ID is used by the collector candidate.
export function expandSmallMedium(item) {
  if (!item.editor) return item;
  const { before = '', visible, after = '', catalog = 0 } = item.editor;
  const entries = Array.from({length:catalog}, (_,i)=>`  { id: ${i+1}, label: "item-${i+1}", enabled: ${i%3!==0} },`).join('\n');
  const middle = catalog ? `\nconst catalog = [\n${entries}\n];\n` : '\n';
  const code = before + middle + visible + '\n' + after;
  if (code.length > 8000) throw Error('Small/medium fixture exceeds 8000 characters');
  return {...item, code, viewport:visible};
}
